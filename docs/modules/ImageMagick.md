# ImageMagick

Run ImageMagick tool (magick).

## Example

```yaml
- module: ImageMagick
  props:
    src: /home/workspace/input.jpg
    dest: /home/workspace/output.png
    args:
      - -resize 50%
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| src | `string` | Source file | `true` |  |
| dest | `string` | Destination file | `true` |  |
| args | `string` | Process Argument list | `true` | `` |

## Output:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| src | `string` | Source file | `true` |  |
| dest | `string` | Destination file | `true` |  |
| args | `string` | Process Argument list | `true` | `` |
| stats | [Stats](#stats) | Process stats object representation | `false` |  |

### Stats<a href="#stats"></a>:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| maxcpu | `number` | Maximum CPU usage | `false` |  |
| maxmem | `number` | Maximum memory usage | `false` |  |
| elapsed | `number` | Elapsed time in milliseconds | `false` |  |

