# Zip

Compresses a directory into a zip file.

## Example

```yaml
- module: Zip
  props:
    src: /home/workspace/asset
    dest: /home/workspace/asset.zip
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| src | `string` | Source file | `false` |  |
| dest | `string` | Destination file | `false` |  |
| config | `Record<string, any>` | Process configuration | `true` |  |

## Output:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| src | `string` | Source file | `false` |  |
| dest | `string` | Destination file | `false` |  |
| config | `Record<string, any>` | Process configuration | `true` |  |
| size | `string` | undefined | `true` | `0` |
