import { z } from "zod";

export const Statement = z.object({
  Action: z.union([z.string(), z.array(z.string())]),
  Resource: z.union([z.string(), z.array(z.string())]),
});

export const PolicyDocument = z.object({
  Version: z.string(),
  Statement: z.array(Statement),
});
export type PolicyDocumentT = z.infer<typeof PolicyDocument>;
