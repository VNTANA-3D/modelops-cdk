# FindAsset

FindAssets tries to find a 3D asset inside a directory.

## Example

```yaml
- module: FindAsset
  props:
    src: /home/workspace/asset
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
| size | `string` | undefined | `true` | `0` |
