import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";

// Default SDMA table — override per-install with SDMA_CONNECTORS_TABLE.
export const DEFAULT_CONNECTORS_TABLE = "SpatialDataManagement-ConnectorsTable";

/**
 * Scans the connectors table for rows whose ConnectorName matches. Returns
 * the oldest match (by CreatedAt) so deploy re-runs overwrite the original
 * row even if earlier misuses of the CLI left duplicate stragglers.
 *
 * @param {{ region: string; table: string; connectorName: string; client?: DynamoDBClient }} opts
 * @returns {Promise<{ connectorId: string; createdAt?: number; duplicateIds: string[] } | null>}
 */
export async function findConnectorByName({ region, table, connectorName, client }) {
  const ddb = client ?? new DynamoDBClient({ region });
  const out = await ddb.send(
    new ScanCommand({
      TableName: table,
      FilterExpression: "ConnectorName = :n",
      ExpressionAttributeValues: { ":n": { S: connectorName } },
      ProjectionExpression: "ConnectorId, CreatedAt",
    }),
  );
  const items = out.Items ?? [];
  if (items.length === 0) return null;

  items.sort((a, b) => Number(a.CreatedAt?.N ?? 0) - Number(b.CreatedAt?.N ?? 0));
  const [primary, ...rest] = items;
  return {
    connectorId: primary.ConnectorId.S,
    createdAt: primary.CreatedAt ? Number(primary.CreatedAt.N) : undefined,
    duplicateIds: rest.map((r) => r.ConnectorId.S),
  };
}

/**
 * @param {{ region: string; table: string; item: Record<string, unknown>; client?: DynamoDBClient }} opts
 */
export async function putConnectorItem({ region, table, item, client }) {
  const ddb = client ?? new DynamoDBClient({ region });
  await ddb.send(new PutItemCommand({ TableName: table, Item: item }));
}
