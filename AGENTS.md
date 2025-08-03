## Environment & Goals

This repository is intended for use exclusively on macOS.
Focus on solutions that are simple to deploy, fail-proof, solid, and polished.

# Composing messages
URL: /introduction/guides/composing-messages

Learn how to compose and send messages from our API, media, PPVs, and more.

***

title: "Composing messages"
description: "Learn how to compose and send messages from our API, media, PPVs, and more."
icon: MessageSquareText
-----------------------

This guide will give you a brief overview of how to compose messages with various elements using our API.

<Callout type="warn">
  Please keep in mind that all of the below examples are meant to be sent as a `POST` request to our `https://app.onlyfansapi.com/api/{account}/chats/{chat_id}/messages` endpoint.

  **Looking for the `chat_id`? Use our [List Chats](/api-reference/chats/listChats) endpoint.**
</Callout>

<Callout>
  **Looking for the developer-oriented documentation?** Please refer to our [API Reference](/api-reference/chats/sendMessage).
</Callout>

## Text-only messages

Simply want to send a regular message? Use the following payload:

```json
{
  "text": "The text of your message"
}
```

## Adding media

Please refer to our dedicated guide on [uploading media](/introduction/guides/uploading-media) for more information on how to upload media files, and how to include them in your chat messages.

## Setting a price (PPV)

To set a price for your chat message, you can use the `price` field in your payload. This will make your message paid (PPV). **All paid messages must contain at least one media file.**

### Only including paid media

To send a paid message without any free preview media, you can use the following payload:

```json
{
  "text": "The text of your message",
  "mediaFiles": ["ofapi_media_123", 3866342509],
  "price": 5
}
```

<Callout>
  The `mediaFiles` parameter can contain either `ofapi_media` IDs, or OnlyFans Vault Media ID (e.g., `3866342509`). You can find more information about these IDs in our [media uploads guide](/introduction/guides/uploading-media). **You can mix-and-match these IDs in the same array.**
</Callout>

### Including free preview media

To send a paid message with free preview media, you can use the `previews` field in your payload. This allows you to include media that will be visible to the recipient, even if they haven't paid for the message.

<Callout>
  **Important!**\
  Make sure to list every `previews` media file in the `mediaFiles` array as well. Otherwise, the API will return an error.

  The `previews` array is only used to indicate which media files are free, while the `mediaFiles` array contains all media files included in the message, regardless of whether they are paid or free.
</Callout>

```json
{
  "text": "The text of your message",
  "mediaFiles": ["ofapi_media_123", 3866342509],
  "previews": ["ofapi_media_456", 1234567890],
  "price": 5
}
```

<Callout>
  The `mediaFiles` and `previews` parameters can contain either `ofapi_media` IDs, or OnlyFans Vault Media ID (e.g., `3866342509`). You can find more information about these IDs in our [media uploads guide](/introduction/guides/uploading-media). **You can mix-and-match these IDs in the same array.**
</Callout>

## Tagging other OnlyFans creators

To tag other OnlyFans creators in your message, you can use the `rfTag` field in your payload. You can specify multiple creators by providing an array of their OnlyFans user IDs.

```json
{
  "text": "The text of your message",
  "rfTag": [123, 456]
}
```

<Callout>
  **How to find the OnlyFans user ID of a creator?**

  * **If you've connected the relevant creator account to OnlyFans API**, you can use our [List Accounts](/api-reference/account/listAccounts) endpoint.
  * **Not connected, but you know the creator's username?** You can use our [Get Profile Details](/api-reference/public-profiles/getProfileDetails) endpoint.
  * **Not connected and don't know the username?** You can use our [Search Profiles](/api-reference/public-profiles/searchProfiles) endpoint.
</Callout>

## Formatting your message text

Please refer to our dedicated guide on [text formatting](/introduction/guides/text-formatting) for more information on how to format your message text, including text styles, colors, and more.

# Text formatting
URL: /introduction/guides/text-formatting

Learn how to format text in your posts and chat messages.

***

title: "Text formatting"
description: "Learn how to format text in your posts and chat messages."
icon: Type
----------

## Best practices

Generally, all text should be contained within one singular `<p>` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
</p>
```

## New lines

To create a new line, you can use the `<br>` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <br>
    This is a new line!
</p>
```

Which will render as:

> Hi there! This is a message containing normal text\
> This is a new line!

## Text sizes

OnlyFans has the following text size options:

* Largest
* Large
* Default
* Small
* Smallest

![OnlyFans text size options](/images/of-text-sizes.png)

You can use them as follows:

### Smallest

To create the smallest text, you can use the `<span class="m-editor-fs__sm">` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <span class="m-editor-fs__sm">This is the smallest text!</span>
</p>
```

### Small

To create a small text, you can use the `<span class="m-editor-fs__s">` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <span class="m-editor-fs__s">This is a small text!</span>
</p>
```

### Large

To create a large text, you can use the `<span class="m-editor-fs__l">` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <span class="m-editor-fs__l">This is a large text!</span>
</p>
```

### Largest

To create the largest text, you can use the `<span class="m-editor-fs__lg">` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <span class="m-editor-fs__lg">This is the largest text!</span>
</p>
```

## Text styles

When using text styles like **bold** or *italic*, make sure that you wrap the text in a `<span class="m-editor-fs__default">` tag. Example:

```html
<span class="m-editor-fs__default">
    <strong>Bold text</strong>
    <em>Italic text</em>
</span>
```

### Bold

To create bold text, you can use the `<strong>` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <span class="m-editor-fs__default"><strong>This is bold text!</strong></span>
</p>
```

### Italic

To create italic text, you can use the `<em>` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <span class="m-editor-fs__default"><em>This is italic text!</em></span>
</p>
```

## Text colors

OnlyFans has three possible colors for text:

* Gray (`#8a96a3`)
* Blue 1 (`#00aff0`)
* Blue 2 (`#1b98e0`)

![OnlyFans text color options](/images/of-text-color-options.png)

You can use them as follows:

### Gray

To create gray text, you can use the `<span class="m-editor-fs__default m-editor-fc__gray">` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <span class="m-editor-fs__default m-editor-fc__gray">This is gray text!</span>
</p>
```

### Blue 1

To create blue 1 text, you can use the `<span class="m-editor-fs__default m-editor-fc__blue-1">` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <span class="m-editor-fs__default m-editor-fc__blue-1">This is blue 1 text!</span>
</p>
```

### Blue 2

To create blue 2 text, you can use the `<span class="m-editor-fs__default m-editor-fc__blue-2">` tag. Example:

```html
<p>
    Hi there! This is a message containing normal text
    <span class="m-editor-fs__default m-editor-fc__blue-2">This is blue 2 text!</span>
</p>
```
