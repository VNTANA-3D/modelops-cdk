# usdchecker

Run usdchecker - Utility for checking the compliance of a given USD stage or a USDZ package

## Example

```yaml
- module: usdchecker
  props:
    src: /home/workspace/input.usdz
    dest: /home/workspace/output.txt
    config:
      arkit: true
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| src | `string` | Source file | `false` |  |
| dest | `string` | Destination file | `false` |  |
| config | `Record<string, any>` | Process configuration | `true` |  |
| resultKey | `string` | State variable which will be set when output file is written | `true` |  |

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

