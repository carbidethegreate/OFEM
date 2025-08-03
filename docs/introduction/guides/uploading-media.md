# Uploading media
URL: /introduction/guides/uploading-media

Learn how to upload photos/videos, and include them in your posts or messages.

***

title: Uploading media
description: "Learn how to upload photos/videos, and include them in your posts or messages."
icon: Upload
------------

OnlyFans API makes it really easy to include photos and videos in your posts and messages. You can upload media files directly to our API, and then reference them in our relevant endpoints.

## Prepare the relevant photo or video

* If you want to use a new photo or video, you may upload it to our API.
* Alternatively, if you want to use a photo or video from your Vault, you may reference its ID directly in the relevant endpoints.

### Upload your photo or video to our API

<Callout>
  The full media upload endpoint documentation can be found
  [here](/api-reference/media/uploadMediaToTheOnlyFansCDN).
</Callout>

Submit a POST request to our `https://app.onlyfansapi.com/api/{account}/media/upload` endpoint, with `form-data` as the body type.

It must have a `file` field, which is the media file you want to upload. This can either be a photo or a video, and it can be in any format that OnlyFans supports (e.g., JPEG, PNG, MP4).

```bash tab="cURL"
curl --location 'https://app.onlyfansapi.com/api/{account}/media/upload' \
     --header 'Authorization: Bearer {token}' \
     --form 'file=@"/Users/me/Documents/MyVideo.mp4"'
```

```ts tab="JavaScript (Fetch)"
const myHeaders = new Headers();
myHeaders.append("Authorization", "Bearer {token}");

const formdata = new FormData();
formdata.append("file", fileInput.files[0], "MyVideo.mp4");

const requestOptions = {
  method: "POST",
  headers: myHeaders,
  body: formdata,
  redirect: "follow",
};

fetch("https://app.onlyfansapi.com/api/{account}/media/upload", requestOptions)
  .then((response) => response.text())
  .then((result) => console.log(result))
  .catch((error) => console.error(error));
```

```js tab="Node.js (Axios)"
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
let data = new FormData();
data.append("file", fs.createReadStream("/Users/me/Documents/MyVideo.mp4"));

let config = {
  method: "post",
  maxBodyLength: Infinity,
  url: "https://app.onlyfansapi.com/api/{account}/media/upload",
  headers: {
    Authorization: "Bearer {token}",
    ...data.getHeaders()
  },
  data: data
};

axios
  .request(config)
  .then((response) => {
    console.log(JSON.stringify(response.data));
  })
  .catch((error) => {
    console.log(error);
  });
```

```php tab="PHP (Guzzle)"
$client = new Client();

$headers = [
    'Authorization' => 'Bearer {token}'
];

$options = [
    'multipart' => [
    [
        'name' => 'file',
        'contents' => Utils::tryFopen('/Users/me/Documents/MyVideo.mp4', 'r'),
        'filename' => '/Users/me/Documents/MyVideo.mp4',
    ]
]];

$request = new Request('POST', 'https://app.onlyfansapi.com/api/{account}/media/upload', $headers);

$res = $client->sendAsync($request, $options)->wait();

echo $res->getBody();
```

**If the upload was successful, the response will be something as follows:**

```json
{
  "prefixed_id": "ofapi_media_123",
  "file_name": "MyVideo.mp4",
  "processId": "a9k3l2m7n8p0q4r5s6t",
  "host": "convert1.onlyfans.com",
  "sourceUrl": "https://of2transcoder.s3.amazonaws.com/upload/642a4d7e-134e-4cb4-99b5-6774248341c2/57141494436/file_name.jpg?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=token&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=credentials&X-Amz-Date=20250521T151119Z&X-Amz-SignedHeaders=host&X-Amz-Expires=604800&X-Amz-Signature=signature",
  "extra": "YW4gZW5jb2RlZCBzdHJpbmcgYW4gZW5jb2RlZCBzdHJpbmcgYW4gZW5jb2RlZCBzdHJpbmcgYW4gZW5jb2RlZCBzdHJpbmcgYW4gZW5jb2RlZCBzdHJpbmcgYW4gZW5jb2RlZCBzdHJpbmcgYW4gZW5jb2RlZCBzdHJpbmcgYW4gZW5jb2RlZCBzdHJpbmcgYW4gZW5jb2RlZA==",
  "additional": {
    "user": "123"
  },
  "thumbs": [
    {
      "id": 1,
      "url": "https://cdn2.onlyfans.com/files/f/f0/fsdnjdsnf3k2rk/300x300_fjkdnknk23efsknj.jpg?Expires=1750518679&Signature=signature&Key-Pair-Id=PAIRID"
    }
  ]
}
```

You may use the `prefixed_id` (e.g., `ofapi_media_123`) in our relevant endpoints to include this media file.

<Callout type="warn">
  **Important!**

  The `prefixed_id` from the above request can only be used **once**. After you use it in a post or message, it will no longer be valid for future use. If you want to reuse the same media file, you must upload it again to get a new `prefixed_id`.
</Callout>

## Including your media in a new post

<Callout>
  The full send post endpoint documentation can be found
  [here](/api-reference/posts/sendPost).
</Callout>

Once you have retrieved the correct media IDs (either from the upload response, or from your Vault), you can include them in your post:

```json Example request body
{
  "text": "The text of your post",
  "mediaFiles": ["ofapi_media_123", "1234567890"]
}
```

## Including your media in a chat message

<Callout>
  The full send chat message endpoint documentation can be found
  [here](/api-reference/chats/sendMessage).
</Callout>

Once you have retrieved the correct media IDs (either from the upload response, or from your Vault), you can include them in your post:

```json Example request body
{
  "text": "The text of your message",
  "mediaFiles": ["ofapi_media_123", "1234567890"]
}
```

## Media file array options

You can include two different types of IDs in the `mediaFiles` array:

1. An OnlyFans API ID starting with `ofapi_media_`. This needs to be the `prefixed_id` of the media file we just uploaded.

   <Callout type="warn">
     **Important! The `ofapi_media_` ID from a media file upload can only be used once.**

     After you use it in a post or message, it will no longer be valid for future use. To use the media again, you must use the OnlyFans Vault Media ID.
   </Callout>

2. An OnlyFans Vault Media ID like `1234567890`. This is the OnlyFans ID of a media file that already exists in the Vault. Use our [List Vault Media](api-reference/media-vault/listVaultMedia) endpoint to retrieve this ID.

## Demo video

<Card>
  <iframe src="https://cap.link/gynx4e5rjtt996q" width="100%" height="400px" frameBorder="0" title="OnlyFans API Media Upload tutorial" allowFullScreen />
</Card>
