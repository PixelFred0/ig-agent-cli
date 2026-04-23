import { z } from "zod";

export const GraphErrorSchema = z.object({
  message: z.string(),
  type: z.string().optional(),
  code: z.number(),
  error_subcode: z.number().optional(),
  fbtrace_id: z.string().optional(),
});

export const PagingCursorsSchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
});

export const PagingSchema = z.object({
  cursors: PagingCursorsSchema.optional(),
  next: z.string().optional(),
  previous: z.string().optional(),
});

export const IgUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  followers_count: z.number().optional(),
  media_count: z.number().optional(),
  biography: z.string().optional(),
  profile_picture_url: z.string().optional(),
});

export const MediaTypeSchema = z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]);
export const MediaProductTypeSchema = z.enum(["FEED", "REELS", "STORY", "AD"]);

export const MediaSchema = z.object({
  id: z.string(),
  caption: z.string().optional(),
  media_type: MediaTypeSchema.optional(),
  media_product_type: MediaProductTypeSchema.optional(),
  media_url: z.string().optional(),
  permalink: z.string().optional(),
  thumbnail_url: z.string().optional(),
  timestamp: z.string().optional(),
  username: z.string().optional(),
  comments_count: z.number().optional(),
  like_count: z.number().optional(),
});

export const MediaListSchema = z.object({
  data: z.array(MediaSchema),
  paging: PagingSchema.optional(),
});

export const InsightValueSchema = z.object({
  value: z.union([z.number(), z.record(z.string(), z.number())]),
  end_time: z.string().optional(),
});

export const InsightMetricSchema = z.object({
  name: z.string(),
  period: z.string().optional(),
  values: z.array(InsightValueSchema).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  id: z.string().optional(),
});

export const InsightsResponseSchema = z.object({
  data: z.array(InsightMetricSchema),
});

export const TokenExchangeSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

export const CommentSchema = z.object({
  id: z.string(),
  text: z.string().optional(),
  username: z.string().optional(),
  timestamp: z.string().optional(),
  like_count: z.number().optional(),
  hidden: z.boolean().optional(),
  replies: z
    .object({
      data: z.array(
        z.object({
          id: z.string(),
          text: z.string().optional(),
          username: z.string().optional(),
          timestamp: z.string().optional(),
          like_count: z.number().optional(),
          hidden: z.boolean().optional(),
        }),
      ),
      paging: PagingSchema.optional(),
    })
    .optional(),
});

export const CommentsResponseSchema = z.object({
  data: z.array(CommentSchema),
  paging: PagingSchema.optional(),
});

export type IgUser = z.infer<typeof IgUserSchema>;
export type Media = z.infer<typeof MediaSchema>;
export type MediaType = z.infer<typeof MediaTypeSchema>;
export type MediaProductType = z.infer<typeof MediaProductTypeSchema>;
export type InsightMetric = z.infer<typeof InsightMetricSchema>;
export type GraphError = z.infer<typeof GraphErrorSchema>;
export type Comment = z.infer<typeof CommentSchema>;
