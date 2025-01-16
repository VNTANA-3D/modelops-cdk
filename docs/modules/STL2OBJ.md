# STL2OBJ

Converts an STL or PLY 3D asset into a glTF or glb 3D asset.

## Example

```yaml
- module: STL2OBJ
  props:
    src: /home/workspace/asset.stl
    dest: /home/workspace/asset_opt.obj
    config:
      f: obj
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
| stats | [Stats](#stats) | Process stats object representation | `false` |  |
| size | `string` | undefined | `true` | `0` |

### Stats<a href="#stats"></a>:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| maxcpu | `number` | Maximum CPU usage | `false` |  |
| maxmem | `number` | Maximum memory usage | `false` |  |
| elapsed | `number` | Elapsed time in milliseconds | `false` |  |

