import { Command } from "commander";

export const program = new Command();

program
  .description("Gets the Permalinks of your VNTANA embed URLs.")
  .argument(
    "LINK",
    "VNTANA Link to your product (e.g. `https://platform.vntana.com/{organization}/{folder}/products/details/{uuid}`.)",
  )
  .action(async (link) => {
    const platformData = splitPlatformURL(link) || splitEmbedURL(link);

    if (!platformData) {
      console.error("Invalid link");
      process.exit(1);
    }

    const { environment, organization, client, product } = platformData;

    const baseUrl = `https://api.${!environment ? "" : environment + "."}vntana.com`;
    const productUrl = `${baseUrl}/products/${product}/organizations/${organization}/clients/${client}`;
    const response = await fetch(productUrl);
    const productData = await response.json();

    const blobId = productData.response.asset.models.find(
      (model) => model.conversionFormat === "GLB",
    )?.modelBlobId;

    const blobUrl = `${baseUrl}/assets/products/${product}/organizations/${organization}/clients/${client}/${blobId}`;
    console.log(blobUrl);
  });

export function splitPlatformURL(url) {
  const regexp =
    /https:\/\/platform\.((dev|acc|stg)\.|)vntana.com\/(\S+)\/(\S+)\/products\/(?:edit|details)\/([A-Za-z0-9-]+)/;
  const tag = url.match(regexp);
  if (!tag) {
    return;
  }
  const [environment, organization, client, product] = tag.slice(2, 6);
  if (!organization || !client || !product) {
    return;
  }
  return {
    environment,
    organization,
    client,
    product,
  };
}

export function splitEmbedURL(url) {
  try {
    const { host, searchParams: params } = new URL(url);
    const tag = host.match(/embed\.((dev|acc|stg)\.|)vntana.com\/?/);
    if (!tag) {
      return;
    }
    const environment = tag[2];
    const organization = params.get("organizationSlug");
    const client = params.get("clientSlug");
    const product = params.get("productUuid");
    if (!organization || !client || !product) {
      return;
    }
    return {
      environment,
      organization,
      client,
      product,
    };
  } catch (error) {
    return;
  }
}
