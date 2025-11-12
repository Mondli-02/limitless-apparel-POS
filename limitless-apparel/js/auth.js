// auth.js - IMPROVED ERROR HANDLING
import { supabase } from './supabase-client.js'

export class AuthManager {
    constructor() {
        this.currentUser = null
        this.session = null
        this.userProfile = null
        console.log('AuthManager initialized')
    }

    async init() {
        if (this.session) {
            console.log('Session already initialized, skipping re-init');
            return true;
        }
        console.log('AuthManager.init() called')
        try {
            const { data: { session }, error } = await supabase.auth.getSession()
            console.log('Session check result:', { session, error })

            if (session && !error) {
                this.session = session
                this.currentUser = session.user
                console.log('Session found, loading user profile...')
                await this.loadUserProfile()
                this.setupAuthStateListener()
                return true
            }
            return false
        } catch (error) {
            console.error('Init error:', error)
            return false
        }
    }

    async login(email, password, role) {
        try {
            console.log('Attempting login for:', { email, role })
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            })

            console.log('Supabase auth response:', { data, error })

            if (error) throw error

            if (data.user) {
                this.currentUser = data.user
                this.session = data.session

                // Load user profile to verify role
                const profile = await this.loadUserProfile()
                console.log('User profile loaded:', profile)

                if (!profile) {
                    throw new Error('User profile not found')
                }

                if (profile.role !== role) {
                    console.log('Role mismatch:', { expected: role, actual: profile.role })
                    await this.logout()
                    throw new Error(`This account does not have ${role} privileges`)
                }

                this.setupAuthStateListener()
                console.log('Login successful, returning success')

                return {
                    success: true,
                    user: data.user,
                    profile: profile,
                    role: profile.role
                }
            }
        } catch (error) {
            console.error('Login error:', error)
            return { success: false, error: error.message }
        }
    }

    async loadUserProfile() {
        if (!this.currentUser) {
            console.log('No current user, cannot load profile')
            return null
        }

        try {
            console.log('Loading profile for user:', this.currentUser.id)
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', this.currentUser.id)
                .single()

            if (error) {
                console.error('Error loading user profile:', error)
                // Check if it's a "not found" error
                if (error.code === 'PGRST116') {
                    console.error('User profile not found in database. Make sure user exists in public.users table.')
                }
                return null
            }

            this.userProfile = data
            return data
        } catch (error) {
            console.error('Unexpected error loading profile:', error)
            return null
        }
    }

    async getUserRole() {
        if (!this.userProfile) {
            await this.loadUserProfile()
        }
        return this.userProfile?.role
    }

    async logout() {
        console.log('Logging out...');

        // Clear local state immediately
        this.currentUser = null;
        this.session = null;
        this.userProfile = null;

        // Clear storage
        localStorage.removeItem('remember_me');
        sessionStorage.clear();

        try {
            const { error } = await supabase.auth.signOut();
            if (error) {
                console.error('Supabase logout error:', error);
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Give Supabase time to clear session fully
            console.log('Redirecting to login...');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 300);
        }
    }


    setupAuthStateListener() {
        console.log('Setting up auth state listener')
        supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('Auth state changed:', event)
            if (event === 'SIGNED_OUT') {
                this.currentUser = null
                this.session = null
                this.userProfile = null
                console.log('Signed out event received')
            }
        })
    }

    getCurrentUser() {
        return this.currentUser
    }

    getUserProfile() {
        return this.userProfile
    }

    isAuthenticated() {
        return !!this.currentUser
    }

    async getCurrentUserRole() {
        return await this.getUserRole()
    }
}

export const authManager = new AuthManager()