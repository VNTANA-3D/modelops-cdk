# Http

Http callback function

## Example

```yaml
- module: Http
  props:
    url: "https://www.google.com"
    method: GET
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| url | `string` | URL to send the request to | `false` |  |
| method | `GET / POST` | HTTP method | `false` |  |
| headers | `Record<string, any>` | HTTP headers | `true` |  |
| body | `string` | HTTP body | `true` |  |
| debug | `boolean` | Debug mode | `true` | false |
| base64 | `boolean` | Body is base64 encoded | `true` | false |
