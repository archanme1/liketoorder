
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
                },"business_photos": {
                  Row: {
                    "business_id": string,"created_at": string,"id": string,"kind": string,"menu_item_id": string | null,"path": string,"position": number | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"id"?: string,"kind": string,"menu_item_id"?: string | null,"path": string,"position"?: number | null,"status"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"menu_item_id"?: string | null,"path"?: string,"position"?: number | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_photos_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "business_photos_menu_item_id_fkey"
      columns: ["menu_item_id"]
isOneToOne: false
      referencedRelation: "menu_items"
      referencedColumns: ["id"]
    }
                  ]
                },"businesses": {
                  Row: {
                    "accepts_table_requests": boolean,"created_at": string,"cuisine_code": string,"currency_code": string | null,"id": string,"is_listed": boolean,"map_lat": number | null,"map_lng": number | null,"name": string,"owner_id": string,"public_address": string | null,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepts_table_requests"?: boolean,"created_at"?: string,"cuisine_code": string,"currency_code"?: string | null,"id"?: string,"is_listed"?: boolean,"map_lat"?: number | null,"map_lng"?: number | null,"name": string,"owner_id": string,"public_address"?: string | null,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "accepts_table_requests"?: boolean,"created_at"?: string,"cuisine_code"?: string,"currency_code"?: string | null,"id"?: string,"is_listed"?: boolean,"map_lat"?: number | null,"map_lng"?: number | null,"name"?: string,"owner_id"?: string,"public_address"?: string | null,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "businesses_cuisine_code_fkey"
      columns: ["cuisine_code"]
isOneToOne: false
      referencedRelation: "cuisines"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "businesses_currency_code_fkey"
      columns: ["currency_code"]
isOneToOne: false
      referencedRelation: "currencies"
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
                },"currencies": {
                  Row: {
                    "code": string,"minor_units": number,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"minor_units": number,"name": string
                  }
                  Update: {
                    "code"?: string,"minor_units"?: number,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"menu_items": {
                  Row: {
                    "business_id": string,"created_at": string,"description": string | null,"id": string,"is_available": boolean,"name": string,"position": number,"price_minor": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_available"?: boolean,"name": string,"position": number,"price_minor"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_available"?: boolean,"name"?: string,"position"?: number,"price_minor"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "menu_items_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
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
                },"storage_cleanup_queue": {
                  Row: {
                    "business_id": string,"path": string,"queued_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"path": string,"queued_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"path"?: string,"queued_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "begin_photo_upload":
{ Args: { "p_kind": string,"p_menu_item_id"?: string }; Returns: Json
                           },
"business_owner_view":
{ Args: { "p_owner_id": string }; Returns: Json
                           },
"claim_photo_cleanup":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"consume_places_quota":
{ Args: { "p_kind": string,"p_user_id": string }; Returns: boolean
                           },
"create_menu_item":
{ Args: { "p_description": string,"p_is_available"?: boolean,"p_name": string,"p_price_minor": number }; Returns: string
                           },
"create_my_business":
{ Args: { "p_accepts_table_requests"?: boolean,"p_cuisine_code": string,"p_name": string,"p_type": string }; Returns: string
                           },
"delete_business_photo":
{ Args: { "p_photo_id": string }; Returns: undefined
                           },
"delete_menu_item":
{ Args: { "p_item_id": string }; Returns: undefined
                           },
"finish_photo_upload":
{ Args: { "p_photo_id": string }; Returns: Json
                           },
"get_my_business":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"move_menu_item":
{ Args: { "p_direction": string,"p_item_id": string }; Returns: undefined
                           },
"set_business_location":
{ Args: { "p_formatted_address": string,"p_lat": number,"p_lng": number,"p_owner_id": string,"p_place_id": string }; Returns: Json
                           },
"set_menu_currency":
{ Args: { "p_code": string }; Returns: undefined
                           },
"set_seller_mode":
{ Args: { "p_on": boolean }; Returns: undefined
                           },
"update_menu_item":
{ Args: { "p_description": string,"p_is_available": boolean,"p_item_id": string,"p_name": string,"p_price_minor": number }; Returns: undefined
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
