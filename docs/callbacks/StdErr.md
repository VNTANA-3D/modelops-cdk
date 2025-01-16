# StdErr

Debugs the value of a variable or a string by printing it to `stderr`.

## Example

```yaml
- module: StdErr
  props:
    metadata:
      key: value
    format: json
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| format | `raw / json / yaml` | Format of the message sent to `stderr`. | `true` | `raw` |
| metadata | `Record<string, any>` | Metadata to be sent to `stderr`. | `true` |  |
