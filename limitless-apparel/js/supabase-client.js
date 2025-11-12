// js/supabase-client.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// Replace these with your EXACT credentials from Supabase
const supabaseUrl = 'https://fcacpnqeyttzygolxotf.supabase.co'  // Your actual URL
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjYWNwbnFleXR0enlnb2x4b3RmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExOTM3MjksImV4cCI6MjA3Njc2OTcyOX0.NIF2jK5z-QciWqXNAM1thpPq1aA4T70tEX3t2p0LICc'  // Your actual anon key

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const initSupabase = () => {
    console.log('Supabase client initialized with URL:', supabaseUrl)
}