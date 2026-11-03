
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "business_locations": {
                  Row: {
                    "business_id": string,"formatted_address": string,"lat": number,"lng": number,"place_id": string,"resolved_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"formatted_address": string,"lat": number,"lng": number,"place_id": string,"resolved_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"formatted_address"?: string,"lat"?: number,"lng"?: number,"place_id"?: string,"resolved_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_locations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: true
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"businesses": {
                  Row: {
                    "accepts_table_requests": boolean,"created_at": string,"cuisine_code": string,"id": string,"is_listed": boolean,"map_lat": number | null,"map_lng": number | null,"name": string,"owner_id": string,"public_address": string | null,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepts_table_requests"?: boolean,"created_at"?: string,"cuisine_code": string,"id"?: string,"is_listed"?: boolean,"map_lat"?: number | null,"map_lng"?: number | null,"name": string,"owner_id": string,"public_address"?: string | null,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "accepts_table_requests"?: boolean,"created_at"?: string,"cuisine_code"?: string,"id"?: string,"is_listed"?: boolean,"map_lat"?: number | null,"map_lng"?: number | null,"name"?: string,"owner_id"?: string,"public_address"?: string | null,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "businesses_cuisine_code_fkey"
      columns: ["cuisine_code"]
isOneToOne: false
      referencedRelation: "cuisines"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "businesses_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cuisines": {
                  Row: {
                    "code": string,"flag": string | null,"icon": string | null,"kind": string,"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"flag"?: never,"icon"?: string | null,"kind": string,"name": string,"sort_order": number
                  }
                  Update: {
                    "code"?: string,"flag"?: never,"icon"?: string | null,"kind"?: string,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"places_rate_limits": {
                  Row: {
                    "count": number,"kind": string,"user_id": string,"window_kind": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count"?: number,"kind": string,"user_id": string,"window_kind": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"kind"?: string,"user_id"?: string,"window_kind"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "bio": string,"city": string,"created_at": string,"display_name": string | null,"id": string,"is_seller": boolean,"updated_at": string,"username": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bio"?: string,"city"?: string,"created_at"?: string,"display_name"?: string | null,"id": string,"is_seller"?: boolean,"updated_at"?: string,"username"?: string | null
                  }
                  Update: {
                    "bio"?: string,"city"?: string,"created_at"?: string,"display_name"?: string | null,"id"?: string,"is_seller"?: boolean,"updated_at"?: string,"username"?: string | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "business_owner_view":
{ Args: { "p_owner_id": string }; Returns: Json
                           },
"consume_places_quota":
{ Args: { "p_kind": string,"p_user_id": string }; Returns: boolean
                           },
"create_my_business":
{ Args: { "p_accepts_table_requests"?: boolean,"p_cuisine_code": string,"p_name": string,"p_type": string }; Returns: string
                           },
"get_my_business":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"set_business_location":
{ Args: { "p_formatted_address": string,"p_lat": number,"p_lng": number,"p_owner_id": string,"p_place_id": string }; Returns: Json
                           },
"set_seller_mode":
{ Args: { "p_on": boolean }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
