import { supabase } from "@/lib/supabase";

export async function getCurrentUserEmail(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();

  if (sessionData.session?.user?.email) {
    return sessionData.session.user.email.trim().toLowerCase();
  }

  const { data: refreshedData, error: refreshError } =
    await supabase.auth.refreshSession();

  if (refreshError) {
    return null;
  }

  if (refreshedData.session?.user?.email) {
    return refreshedData.session.user.email.trim().toLowerCase();
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user?.email) {
    return null;
  }

  return userData.user.email.trim().toLowerCase();
}
