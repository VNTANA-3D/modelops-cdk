# Debug

Debugs the value of a variable or a string by printing it to `stdout`.

## Example

```yaml
- module: Debug
  props:
    var: something
    format: json
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| var | `string` | Name of the variable to `debug`. Can also return the value of the `task` or the `state`. | `false` |  |
| format | `raw / json / yaml` | Format of the message sent to `stdout`. | `true` | `raw` |

## Output:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| var | `string` | Name of the variable to `debug`. Can also return the value of the `task` or the `state`. | `false` |  |
| format | `raw / json / yaml` | Format of the message sent to `stdout`. | `true` | `raw` |
