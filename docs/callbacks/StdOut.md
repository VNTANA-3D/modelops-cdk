# StdOut

Debugs the value of a variable or a string by printing it to `stdout`.

## Example

```yaml
- module: StdOut
  props:
    msg: something
    metadata:
      key: value
    format: json
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| format | `raw / json / yaml` | Format of the message sent to `stdout`. | `true` | `raw` |
| msg | `undefined` | Message to be sent to `stdout`. | `true` |  |
| metadata | `Record<string, any>` | Metadata to be sent to `stdout`. | `true` |  |
