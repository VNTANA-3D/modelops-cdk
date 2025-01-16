# MeshOptimizer

Runs the MeshOptimizer as an container built from the `us.gcr.io/vntana-platform-2/vntana-mesh-optimizer`
image. It sets up the container in a way that it works as if the MeshOptimizer was installed locally.

## Example

```yaml
- module: MeshOptimizer
  props:
    src: /home/workspace/input.glb
    dest: /home/workspace/output.glb
    config:
      output_usdz: true
      detect_instances: true
      reset_scaling: true
      skip_material_visibility: true
      dont_export_tangents: true
      max_tex_size: 2048
      target_tex_density: 3000
      tex_opt_compression: 80
      norm_opt_compression: 80
      tris: 75000
      reset_center: center
      sanitize_normals: true
      remove_animations: true
      remove_obstructed_geometry: true
      skip_ao_baking: true
      pot_textures: true
      bake_small_features: true
      aggressive_alpha_removal: true
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
| json | [Json](#json) | Json optimization object parsed file | `false` |  |
| tracing | `string` | Chrome tracing json file | `false` |  |
| log | `string` | Output log file | `false` |  |
| originalSize | `string` | Original file size | `true` | `0` |
| fbxDest | `string` | FBX destination file | `true` |  |
| fbxSize | `string` | FBX file size | `true` | `0` |
| usdzDest | `string` | USDZ destination file | `true` |  |
| usdzSize | `string` | USDZ file size | `true` | `0` |
| objDest | `string` | OBJ destination zip file | `true` |  |
| objSize | `string` | OBJ zip file size | `true` | `0` |

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

