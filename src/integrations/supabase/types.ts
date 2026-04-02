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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          cad_software: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          experience_level: string | null
          gps_location: string | null
          id: string
          name: string
          occupation: string | null
          primary_purpose: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cad_software?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          experience_level?: string | null
          gps_location?: string | null
          id?: string
          name?: string
          occupation?: string | null
          primary_purpose?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cad_software?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          experience_level?: string | null
          gps_location?: string | null
          id?: string
          name?: string
          occupation?: string | null
          primary_purpose?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_electronics: {
        Row: {
          component_name: string
          created_at: string
          id: string
          model_recommendation: string | null
          price: number | null
          project_id: string
          purpose: string | null
          quantity: number | null
          sort_order: number | null
          status: string | null
          updated_at: string
          user_id: string
          where_to_buy: string | null
        }
        Insert: {
          component_name?: string
          created_at?: string
          id?: string
          model_recommendation?: string | null
          price?: number | null
          project_id: string
          purpose?: string | null
          quantity?: number | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string
          user_id: string
          where_to_buy?: string | null
        }
        Update: {
          component_name?: string
          created_at?: string
          id?: string
          model_recommendation?: string | null
          price?: number | null
          project_id?: string
          purpose?: string | null
          quantity?: number | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string
          user_id?: string
          where_to_buy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_electronics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_parts: {
        Row: {
          complexity: string | null
          created_at: string
          design_guide: string | null
          estimated_cost: number | null
          fix_guide: string | null
          id: string
          manufacturing_method: string | null
          material: string | null
          part_name: string
          project_id: string
          sort_order: number | null
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          complexity?: string | null
          created_at?: string
          design_guide?: string | null
          estimated_cost?: number | null
          fix_guide?: string | null
          id?: string
          manufacturing_method?: string | null
          material?: string | null
          part_name?: string
          project_id: string
          sort_order?: number | null
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          complexity?: string | null
          created_at?: string
          design_guide?: string | null
          estimated_cost?: number | null
          fix_guide?: string | null
          id?: string
          manufacturing_method?: string | null
          material?: string | null
          part_name?: string
          project_id?: string
          sort_order?: number | null
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_parts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          created_at: string
          estimated_hours: number | null
          id: string
          phase: number | null
          project_id: string
          sort_order: number | null
          status: string | null
          task_number: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          estimated_hours?: number | null
          id?: string
          phase?: number | null
          project_id: string
          sort_order?: number | null
          status?: string | null
          task_number?: number
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          estimated_hours?: number | null
          id?: string
          phase?: number | null
          project_id?: string
          sort_order?: number | null
          status?: string | null
          task_number?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget_currency: string | null
          budget_range: string | null
          category: string | null
          complexity: string | null
          control_method: string | null
          created_at: string
          current_phase: number | null
          description: string | null
          environment: string | null
          has_3d_printer: boolean | null
          id: string
          microcontroller: string | null
          power_source: string | null
          progress_percent: number | null
          project_name: string
          purpose: string | null
          target_size: string | null
          target_weight: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_currency?: string | null
          budget_range?: string | null
          category?: string | null
          complexity?: string | null
          control_method?: string | null
          created_at?: string
          current_phase?: number | null
          description?: string | null
          environment?: string | null
          has_3d_printer?: boolean | null
          id?: string
          microcontroller?: string | null
          power_source?: string | null
          progress_percent?: number | null
          project_name?: string
          purpose?: string | null
          target_size?: string | null
          target_weight?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_currency?: string | null
          budget_range?: string | null
          category?: string | null
          complexity?: string | null
          control_method?: string | null
          created_at?: string
          current_phase?: number | null
          description?: string | null
          environment?: string | null
          has_3d_printer?: boolean | null
          id?: string
          microcontroller?: string | null
          power_source?: string | null
          progress_percent?: number | null
          project_name?: string
          purpose?: string | null
          target_size?: string | null
          target_weight?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sensor_configs: {
        Row: {
          connection_type: string
          created_at: string
          device_address: string | null
          id: string
          sensor_name: string
          sensor_type: string
          status: string
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_type?: string
          created_at?: string
          device_address?: string | null
          id?: string
          sensor_name?: string
          sensor_type?: string
          status?: string
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_type?: string
          created_at?: string
          device_address?: string | null
          id?: string
          sensor_name?: string
          sensor_type?: string
          status?: string
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telemetry_sessions: {
        Row: {
          columns: Json
          created_at: string
          data: Json
          file_name: string
          id: string
          row_count: number
          user_id: string
        }
        Insert: {
          columns?: Json
          created_at?: string
          data?: Json
          file_name?: string
          id?: string
          row_count?: number
          user_id: string
        }
        Update: {
          columns?: Json
          created_at?: string
          data?: Json
          file_name?: string
          id?: string
          row_count?: number
          user_id?: string
        }
        Relationships: []
      }
      user_streaks: {
        Row: {
          created_at: string
          current_streak: number | null
          id: string
          last_active_date: string | null
          longest_streak: number | null
          streak_freeze_available: boolean | null
          streak_freeze_used_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_streak?: number | null
          id?: string
          last_active_date?: string | null
          longest_streak?: number | null
          streak_freeze_available?: boolean | null
          streak_freeze_used_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_streak?: number | null
          id?: string
          last_active_date?: string | null
          longest_streak?: number | null
          streak_freeze_available?: boolean | null
          streak_freeze_used_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
