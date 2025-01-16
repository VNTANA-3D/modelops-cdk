# ScreenshotGenerator

Creates snapshots of a 3D model based on entered

## Example

```yaml
- module: ScreenshotGenerator
  props:
    src: /home/workspace/asset.glb
    dest: /home/workspace
    args:
        - -r
        - -w 1024
        - -h 1024
        - -c "{}"
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| src | `string` | Source file | `true` |  |
| dest | `string` | Destination file | `true` |  |
| args | `string` | Process Argument list | `true` | `` |
| timeout | `number` | Time in milliseconds to wait for the process to finish | `true` |  |

## Output:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| src | `string` | Source file | `true` |  |
| dest | `string` | Destination file | `true` |  |
| args | `string` | Process Argument list | `true` | `` |
| timeout | `number` | Time in milliseconds to wait for the process to finish | `true` |  |
| stats | [Stats](#stats) | Process stats object representation | `false` |  |
| json | [Json](#json) | Json model dump file | `false` |  |

### Stats<a href="#stats"></a>:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| maxcpu | `number` | Maximum CPU usage | `false` |  |
| maxmem | `number` | Maximum memory usage | `false` |  |
| elapsed | `number` | Elapsed time in milliseconds | `false` |  |

### Json<a href="#json"></a>:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| root | `string` | The root of the path such as '/' or 'c:' | `false` |  |
| dir | `string` | The full directory path such as '/home/user/dir' or 'c:pathdir' | `false` |  |
| base | `string` | The file name including extension (if any) such as 'index.html' | `false` |  |
| ext | `string` | The file extension (if any) such as '.html' | `false` |  |
| name | `string` | The file name without extension (if any) such as 'index' | `false` |  |

