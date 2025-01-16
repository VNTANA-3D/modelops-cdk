# StdErr

Sends a message to `stderr`.

## Example

```typescript
- module: StdErr
  props:
    message: something
    metadata:
      foo: bar
    format: json
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| msg | `string` | Message to send to `stderr`. | `false` |  |
| metadata | `Record<string, any>` | Additional metadata to be included in the output. | `true` |  |
| format | `raw / json / yaml` | Format of the message sent to `stdout`. | `true` | `raw` |

## Output:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| msg | `string` | Message to send to `stderr`. | `false` |  |
| metadata | `Record<string, any>` | Additional metadata to be included in the output. | `true` |  |
| format | `raw / json / yaml` | Format of the message sent to `stdout`. | `true` | `raw` |
| stderr | `string` | Message sent to `stderr`. | `false` |  |
| lines | `string` | Message sent to `stderr` separated by new lines (`\n`). | `false` |  |
