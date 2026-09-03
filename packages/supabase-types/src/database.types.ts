// Generated from Supabase project jndqrvwkwoyvzoqcveev via the Supabase MCP
// (generate_typescript_types). Regenerate after every migration; do not edit by hand.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
          status: Database["public"]["Enums"]["follow_status"]
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
          status?: Database["public"]["Enums"]["follow_status"]
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
          status?: Database["public"]["Enums"]["follow_status"]
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_reviews: {
        Row: {
          code_iterations: Json
          created_at: string
          id: string
          model: string
          moments: Json
          next_steps: Json
          overall: number | null
          scores: Json
          session_id: string
          summary: string | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          code_iterations?: Json
          created_at?: string
          id?: string
          model: string
          moments?: Json
          next_steps?: Json
          overall?: number | null
          scores?: Json
          session_id: string
          summary?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          code_iterations?: Json
          created_at?: string
          id?: string
          model?: string
          moments?: Json
          next_steps?: Json
          overall?: number | null
          scores?: Json
          session_id?: string
          summary?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_reviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          body: string | null
          created_at: string
          id: string
          include_ai_insights: boolean
          published_at: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["post_status"]
          title: string | null
          updated_at: string
          user_id: string
          video_id: string | null
          video_kind: Database["public"]["Enums"]["video_kind"]
          visibility: Database["public"]["Enums"]["post_visibility"]
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          include_ai_insights?: boolean
          published_at?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          title?: string | null
          updated_at?: string
          user_id: string
          video_id?: string | null
          video_kind?: Database["public"]["Enums"]["video_kind"]
          visibility?: Database["public"]["Enums"]["post_visibility"]
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          include_ai_insights?: boolean
          published_at?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
          video_id?: string | null
          video_kind?: Database["public"]["Enums"]["video_kind"]
          visibility?: Database["public"]["Enums"]["post_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "posts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          handle: string | null
          id: string
          is_private: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          handle?: string | null
          id: string
          is_private?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          handle?: string | null
          id?: string
          is_private?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      session_events: {
        Row: {
          id: number
          payload: Json
          session_id: string
          t: string
          type: Database["public"]["Enums"]["session_event_type"]
        }
        Insert: {
          id?: never
          payload?: Json
          session_id: string
          t?: string
          type: Database["public"]["Enums"]["session_event_type"]
        }
        Update: {
          id?: never
          payload?: Json
          session_id?: string
          t?: string
          type?: Database["public"]["Enums"]["session_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_problems: {
        Row: {
          active_ms: number
          closed_at: string | null
          created_at: string
          description_html: string | null
          difficulty: Database["public"]["Enums"]["problem_difficulty"] | null
          edits_path: string | null
          frontend_id: string | null
          id: string
          opened_at: string
          session_id: string
          slug: string
          title: string
          topic_tags: Json
          url: string
        }
        Insert: {
          active_ms?: number
          closed_at?: string | null
          created_at?: string
          description_html?: string | null
          difficulty?: Database["public"]["Enums"]["problem_difficulty"] | null
          edits_path?: string | null
          frontend_id?: string | null
          id?: string
          opened_at?: string
          session_id: string
          slug: string
          title: string
          topic_tags?: Json
          url: string
        }
        Update: {
          active_ms?: number
          closed_at?: string | null
          created_at?: string
          description_html?: string | null
          difficulty?: Database["public"]["Enums"]["problem_difficulty"] | null
          edits_path?: string | null
          frontend_id?: string | null
          id?: string
          opened_at?: string
          session_id?: string
          slug?: string
          title?: string
          topic_tags?: Json
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_problems_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          active_ms: number
          client: string | null
          created_at: string
          ended_at: string | null
          id: string
          kind: Database["public"]["Enums"]["session_kind"]
          recording_id: string | null
          scope: Database["public"]["Enums"]["session_scope"]
          started_at: string
          status: Database["public"]["Enums"]["session_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          active_ms?: number
          client?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["session_kind"]
          recording_id?: string | null
          scope?: Database["public"]["Enums"]["session_scope"]
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          active_ms?: number
          client?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["session_kind"]
          recording_id?: string | null
          scope?: Database["public"]["Enums"]["session_scope"]
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          accepted: boolean
          code: string | null
          created_at: string
          id: string
          lang: string | null
          lang_verbose: string | null
          leetcode_submission_id: number | null
          memory_display: string | null
          memory_distribution: Json | null
          memory_mb: number | null
          memory_percentile: number | null
          runtime_display: string | null
          runtime_distribution: Json | null
          runtime_ms: number | null
          runtime_percentile: number | null
          session_problem_id: string
          status_code: number | null
          status_display: string | null
          submitted_at: string
          total_correct: number | null
          total_testcases: number | null
        }
        Insert: {
          accepted?: boolean
          code?: string | null
          created_at?: string
          id?: string
          lang?: string | null
          lang_verbose?: string | null
          leetcode_submission_id?: number | null
          memory_display?: string | null
          memory_distribution?: Json | null
          memory_mb?: number | null
          memory_percentile?: number | null
          runtime_display?: string | null
          runtime_distribution?: Json | null
          runtime_ms?: number | null
          runtime_percentile?: number | null
          session_problem_id: string
          status_code?: number | null
          status_display?: string | null
          submitted_at?: string
          total_correct?: number | null
          total_testcases?: number | null
        }
        Update: {
          accepted?: boolean
          code?: string | null
          created_at?: string
          id?: string
          lang?: string | null
          lang_verbose?: string | null
          leetcode_submission_id?: number | null
          memory_display?: string | null
          memory_distribution?: Json | null
          memory_mb?: number | null
          memory_percentile?: number | null
          runtime_display?: string | null
          runtime_distribution?: Json | null
          runtime_ms?: number | null
          runtime_percentile?: number | null
          session_problem_id?: string
          status_code?: number | null
          status_display?: string | null
          submitted_at?: string
          total_correct?: number | null
          total_testcases?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_session_problem_id_fkey"
            columns: ["session_problem_id"]
            isOneToOne: false
            referencedRelation: "session_problems"
            referencedColumns: ["id"]
          },
        ]
      }
      transcripts: {
        Row: {
          created_at: string
          id: string
          language: string
          model: string
          segments: Json
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string
          model: string
          segments?: Json
          session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string
          model?: string
          segments?: Json
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          bunny_video_id: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          height: number | null
          id: string
          library_id: number
          mode: Database["public"]["Enums"]["video_mode"]
          ready_at: string | null
          size_bytes: number | null
          status: Database["public"]["Enums"]["video_status"]
          thumbnail_path: string | null
          updated_at: string
          user_id: string
          width: number | null
        }
        Insert: {
          bunny_video_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          height?: number | null
          id?: string
          library_id: number
          mode?: Database["public"]["Enums"]["video_mode"]
          ready_at?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["video_status"]
          thumbnail_path?: string | null
          updated_at?: string
          user_id: string
          width?: number | null
        }
        Update: {
          bunny_video_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          height?: number | null
          id?: string
          library_id?: number
          mode?: Database["public"]["Enums"]["video_mode"]
          ready_at?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["video_status"]
          thumbnail_path?: string | null
          updated_at?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "videos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_follow: { Args: { follower: string }; Returns: undefined }
      decline_follow: { Args: { follower: string }; Returns: undefined }
      feed: {
        Args: { before?: string; page_size?: number }
        Returns: {
          body: string | null
          created_at: string
          id: string
          include_ai_insights: boolean
          published_at: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["post_status"]
          title: string | null
          updated_at: string
          user_id: string
          video_id: string | null
          video_kind: Database["public"]["Enums"]["video_kind"]
          visibility: Database["public"]["Enums"]["post_visibility"]
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      profile_stats: { Args: { target_handle: string }; Returns: Json }
      request_follow: {
        Args: { target_handle: string }
        Returns: Database["public"]["Enums"]["follow_status"]
      }
    }
    Enums: {
      follow_status: "pending" | "accepted"
      post_status: "draft" | "published"
      post_visibility: "public" | "private"
      problem_difficulty: "Easy" | "Medium" | "Hard"
      session_event_type:
        | "start"
        | "pause"
        | "resume"
        | "end"
        | "problem_open"
        | "problem_close"
      session_kind: "practice" | "interview"
      session_scope: "session" | "problem"
      session_status: "active" | "paused" | "ended" | "abandoned"
      video_kind: "none" | "full" | "highlights"
      video_mode: "instant" | "studio"
      video_status:
        | "created"
        | "uploading"
        | "uploaded"
        | "processing"
        | "ready"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      follow_status: ["pending", "accepted"],
      post_status: ["draft", "published"],
      post_visibility: ["public", "private"],
      problem_difficulty: ["Easy", "Medium", "Hard"],
      session_event_type: [
        "start",
        "pause",
        "resume",
        "end",
        "problem_open",
        "problem_close",
      ],
      session_kind: ["practice", "interview"],
      session_scope: ["session", "problem"],
      session_status: ["active", "paused", "ended", "abandoned"],
      video_kind: ["none", "full", "highlights"],
      video_mode: ["instant", "studio"],
      video_status: [
        "created",
        "uploading",
        "uploaded",
        "processing",
        "ready",
        "failed",
      ],
    },
  },
} as const
