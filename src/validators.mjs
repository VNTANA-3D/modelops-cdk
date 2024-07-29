import { z } from "zod";

export const Event = z.object({
  timestamp: z.number(),
  message: z.string(),
  ingestionTime: z.number(),
});

export const Logs = z.object({
  nextForwardToken: z.string(),
  events: z.array(Event),
});

export const Jobs = z.object({ jobs: z.array(z.any()).min(1).max(1) });
