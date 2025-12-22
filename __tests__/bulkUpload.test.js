const request = require('supertest');
const express = require('express');

const mockCreateChatCompletion = jest.fn();

jest.mock('openai', () => ({
  Configuration: jest.fn(),
  OpenAIApi: jest.fn(() => ({
    createChatCompletion: mockCreateChatCompletion,
  })),
}));

jest.mock('axios');

function createAppWithEnv(envOverrides = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  mockCreateChatCompletion.mockReset();

  Object.assign(process.env, {
    OPENAI_API_KEY: 'test-openai',
    CF_IMAGES_ACCOUNT_ID: 'cf-account',
    CF_IMAGES_TOKEN: 'cf-token',
    CF_IMAGES_DELIVERY_HASH: 'delivery-hash',
  });

  Object.entries(envOverrides).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  const axiosMock = require('axios');
  axiosMock.post.mockReset();
  axiosMock.get = jest.fn().mockResolvedValue({ data: { success: true } });

  mockCreateChatCompletion.mockResolvedValue({
    data: { choices: [{ message: { content: 'Test caption' } }] },
  });

  const bulkUploadRoutes = require('../routes/bulkUpload');
  const app = express();
  app.use('/api', bulkUploadRoutes);
  return { app, axiosMock };
}

describe('POST /api/bulk-upload', () => {
  test('uploads to Cloudflare and returns media references', async () => {
    const { app, axiosMock } = createAppWithEnv();
    axiosMock.post.mockResolvedValue({
      data: {
        success: true,
        result: {
          id: 'img123',
          variants: ['https://example.com/img123/public'],
        },
      },
    });

    const res = await request(app)
      .post('/api/bulk-upload')
      .attach('images', Buffer.from('filedata'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(200);

    expect(mockCreateChatCompletion).toHaveBeenCalledTimes(1);
    expect(res.body.batchId).toBeDefined();
    expect(res.body.uploadStatus).toBe('ok');
    expect(res.body.uploads[0]).toMatchObject({
      imageId: 'img123',
      url: 'https://imagedelivery.net/delivery-hash/img123/public',
    });
    expect(res.body.captions[0].caption).toBe('Test caption');
  });

  test('returns caption data even when Cloudflare returns 4xx', async () => {
    const { app, axiosMock } = createAppWithEnv();
    axiosMock.post.mockRejectedValue({
      response: {
        status: 400,
        data: { errors: [{ message: 'bad request' }] },
      },
    });

    const res = await request(app)
      .post('/api/bulk-upload')
      .attach('images', Buffer.from('filedata'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(200);

    expect(res.body.batchId).toBeDefined();
    expect(res.body.uploadStatus).toBe('partial-failure');
    expect(res.body.cloudflareError).toMatchObject({
      message: 'bad request',
      statusCode: 400,
      cloudflareStatus: 400,
    });
    expect(res.body.uploads[0]).toMatchObject({ url: null, imageId: null });
    expect(res.body.captions[0].caption).toBe('Test caption');
  });

  test('sanitizes Cloudflare error logs to avoid sensitive headers', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { app, axiosMock } = createAppWithEnv();
      axiosMock.post.mockRejectedValue({
        response: {
          status: 403,
          data: { errors: [{ message: 'forbidden' }] },
        },
        config: {
          headers: {
            Authorization: 'Bearer top-secret',
            'X-Auth-Token': 'another-secret',
          },
        },
        message: 'Request failed',
      });

      await request(app)
        .post('/api/bulk-upload')
      .attach('images', Buffer.from('filedata'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(200);

      const logCall = consoleSpy.mock.calls.find(
        (call) => call[0] === 'Cloudflare upload failed:',
      );
      expect(logCall).toBeDefined();
      const loggedPayload = logCall[1];
      expect(loggedPayload).toMatchObject({
        filename: 'photo.jpg',
        status: 403,
        cloudflareStatus: 403,
        cloudflareErrors: [{ message: 'forbidden' }],
        requestId: null,
      });
      const serialized = JSON.stringify(loggedPayload);
      expect(serialized).not.toMatch(/Authorization: Bearer/i);
      expect(serialized).not.toMatch(/top-secret/);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('returns explicit Cloudflare error when uploads are required', async () => {
    const { app, axiosMock } = createAppWithEnv({
      CF_IMAGES_ACCOUNT_ID: undefined,
      CF_IMAGES_TOKEN: undefined,
    });
    axiosMock.post.mockResolvedValue({}); // should not be called

    const res = await request(app)
      .post('/api/bulk-upload?failOnCloudflareError=true')
      .attach('images', Buffer.from('filedata'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);

    expect(res.body).toMatchObject({
      error: 'Cloudflare Images environment variables missing',
      cloudflareStatus: null,
    });
    expect(axiosMock.post).not.toHaveBeenCalled();
  });

  test('retries failed uploads when retry endpoint is used', async () => {
    const { app, axiosMock } = createAppWithEnv();
    axiosMock.post
      .mockRejectedValueOnce({
        response: {
          status: 400,
          data: { errors: [{ message: 'bad request' }] },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          result: {
            id: 'img-retry',
            variants: ['https://example.com/img-retry/public'],
          },
        },
      });

    const firstRes = await request(app)
      .post('/api/bulk-upload')
      .attach('images', Buffer.from('filedata'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(200);

    expect(firstRes.body.hasFailures).toBe(true);
    expect(firstRes.body.batchId).toBeDefined();

    const retryRes = await request(app)
      .post('/api/bulk-upload/retry')
      .send({ batchId: firstRes.body.batchId })
      .expect(200);

    expect(retryRes.body.uploadStatus).toBe('ok');
    expect(retryRes.body.items[0]).toMatchObject({
      uploadStatus: 'success',
      imageUrl: 'https://imagedelivery.net/delivery-hash/img-retry/public',
    });
  });
});
