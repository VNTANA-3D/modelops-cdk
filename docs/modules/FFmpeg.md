# FFmpeg

Run FFmpeg - Hyper fast Audio and Video encoder.

## Example

```yaml
- module: FFmpeg
  props:
    src: /home/workspace/input.avi
    dest: /home/workspace/output.mp4
    config:
      srcConfig:
        f: avi
      destConfig:
        "b:v": "64k"
        bufsize: "64k"
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

