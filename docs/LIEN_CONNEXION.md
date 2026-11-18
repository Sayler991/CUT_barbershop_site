# Lien de connexion directe à l’espace salon

- Compte propriétaire inscrit dans `cutbarber.admins`. Le mot de passe n’est pas dans ce dépôt.
- Fonction Supabase `cut-owner-link` (`dev/supabase/functions/cut-owner-link/index.ts`) : appelée par un administrateur **déjà connecté**, elle génère côté serveur (`auth.admin.generateLink`, type `magiclink`) un lien pour **son propre** compte. Non connecté → 401 ; compte non administrateur → 403. Aucun e-mail n’est envoyé.
- Format du lien : `https://cut-barbershop.vercel.app/admin/#connexion=<token_hash>`. Le jeton est dans le fragment (`#`), donc jamais envoyé à Vercel ; `/admin/` le retire aussitôt de l’adresse puis l’échange une seule fois via `verifyOtp` (`POST /auth/v1/verify`).
- Usage unique, expiration selon la durée OTP du projet (1 h par défaut). Aucune modification de la configuration Auth (liste des URL de redirection) ni de la liste des schémas exposés n’est nécessaire.
