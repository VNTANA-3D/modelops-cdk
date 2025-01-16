# Stat

Gather facts about a file.

## Example

```yaml
- module: Stat
  props:
    path: /home/workspace/asset.stl
  register: stat
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| path | `string` | Path of the file to gather stats from | `false` |  |

## Output:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| path | `string` | Path of the file to gather stats from | `false` |  |
| stats | `Record<string, any>` | Stats of the file | `true` |  |
