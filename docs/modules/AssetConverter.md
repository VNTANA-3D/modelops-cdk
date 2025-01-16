# AssetConverter

Converts an FBX, OBJ, USD, or STL 3D asset into a GlTF or glb 3D asset. You can use this
converter when you are unsure of which module to use. For example, when you are defining the
asset to convert/optimize programmatically.

It will call the correct converter module from within so, if you know the type of you asset
in advance, it is recommended that you call the proper converter directly instead of relying
on this universal converter. Some features are not supported on this converter in order to make
it general.

The configuration that this module accept will be provided to the next converter module as is.

## Example

```yaml
- module: GlTFConverter
  props:
    src: /home/workspace/asset.fbx
    dest: /home/workspace/asset.glb
    config:
      pbr-metallic-roughness: true
      binary: true
      verbose: true
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| src | `string` | Source file | `false` |  |
| extension | `fbx / obj / glb / gltf / stl / usd / usda / usdc / usdz / step / zip / 3mf / sat / sab / dae / dwg / dxf / 3ds / dwf / dwfx / ipt / iam / nwd / model / session / dlv / exp / catdrawing / catpart / catproduct / catshape / cgr / 3dxml / asm / neu / prt / xax / xpr / dgn / mf1 / arc / unv / pkg / ifc / ifczip / igs / iges / jt / x_b / x_t / xmt / xmt_txt / prc / rvt / rfa / 3dm / par / pwd / psm / sldasm / sldprt / stp / stpz / stpx / stpxz / u3d / vda / wrl / vrml / ply` | Asset extension to look for | `true` |  |
| name | `string` | Name of the asset to look for | `true` |  |

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

