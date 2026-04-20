# Environment Maps

HDR environment maps that the SPDA `ScreenshotGenerator` task loads when
rendering thumbnails for the `cad_zip` pipeline.

## Studio_A_dim.hdr

Source: https://storage.googleapis.com/static-acc-mul-reg-stn-unif-vntana-com/assets/environment_maps/Studio_A_dim.hdr

Uploaded to `s3://development.modelops.vntana.com/assets/env_maps/` by
`./index.mjs -c .env.spda connectors assets-sync` with a public-read
bucket-policy statement keyed by Sid `ModelopsPublicAssets`.

Referenced from `pipelines/zip_cad_to_glb.yaml` via the **path-style** S3
URL, because the bucket name contains dots and virtual-hosted SSL would
fail:

    https://s3.us-east-1.amazonaws.com/development.modelops.vntana.com/assets/env_maps/Studio_A_dim.hdr
