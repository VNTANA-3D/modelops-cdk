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

export const JobSummary = z.object({
  jobArn: z.string(),
  jobId: z.string(),
  jobName: z.string(),
  createdAt: z
    .number()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  stoppedAt: z
    .number()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  startedAt: z
    .number()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  status: z.string(),
});

export const JobsSummary = z.object({
  nextToken: z.string().optional(),
  jobSummaryList: z.array(JobSummary),
});

export const FromAgo = z.tuple([z.coerce.number(), z.string()]);

export const Pair = z.tuple([z.string(), z.any()]);
