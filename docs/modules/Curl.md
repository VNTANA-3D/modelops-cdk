# Curl

Use `curl` to perform an HTTP request and store the output in a file. Can be used to download assets.

## Example

```yaml
- module: Curl
  props:
    src: https://static.vntana.com/my_asset.glb
    dst: /home/workspace/my_asset.glb
    config:
      request:
      location: true
      silent: true
      verbose: true
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

