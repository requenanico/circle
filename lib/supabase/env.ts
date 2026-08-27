export interface PublicSupabaseEnv {
   url: string;
   publishableKey: string;
}

export function getPublicSupabaseEnv(): PublicSupabaseEnv {
   const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
   const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
   const errors: string[] = [];

   if (!url) {
      errors.push('NEXT_PUBLIC_SUPABASE_URL is required');
   } else {
      try {
         const parsedUrl = new URL(url);

         if (parsedUrl.protocol !== 'https:') {
            errors.push('NEXT_PUBLIC_SUPABASE_URL must use HTTPS');
         }
      } catch {
         errors.push('NEXT_PUBLIC_SUPABASE_URL must be a valid URL');
      }
   }

   if (!publishableKey) {
      errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required');
   }

   if (errors.length > 0) {
      throw new Error(`Invalid public Supabase environment:\n- ${errors.join('\n- ')}`);
   }

   return { url: url!, publishableKey: publishableKey! };
}
