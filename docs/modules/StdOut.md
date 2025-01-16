# StdOut

Sends a message to `stdout`.

## Example

```typescript
- module: StdOut
  props:
    message: something
    metadata:
      foo: bar
    format: json
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| msg | `string` | Message to send to `stdout`. | `false` |  |
| metadata | `Record<string, any>` | Additional metadata to be included in the output. | `true` |  |
| format | `raw / json / yaml` | Format of the message sent to `stdout`. | `true` | `raw` |

## Output:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| msg | `string` | Message to send to `stdout`. | `false` |  |
| metadata | `Record<string, any>` | Additional metadata to be included in the output. | `true` |  |
| format | `raw / json / yaml` | Format of the message sent to `stdout`. | `true` | `raw` |
| stdout | `string` | Message sent to `stdout`. | `false` |  |
| lines | `string` | Message sent to `stdout` separated by new lines (`\n`). | `false` |  |
