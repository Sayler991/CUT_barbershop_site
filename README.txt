.CUT barbershop (studio hair) — Tlemcen
Maquette de site avec prise de rendez-vous (démo pour prospect, balise noindex)

Contenu
- index.html, css/, js/app.js : site client (prestations, réservation, photos, avis, horaires, carte)
- admin/ : espace salon (connexion email + mot de passe) : agenda jour/semaine par barbier,
  prestations, barbiers, horaires
- config.js : adresse Supabase + clé publique (sécurité par RLS et fonctions public.cutbarber_*)
- dev/supabase/ : schéma SQL (schéma « cutbarber ») et données de départ

Réservation
Prestation → barbier (Younes, Anis ou « peu importe ») → jour → créneau libre → nom + téléphone.
Les créneaux suivent les horaires et la durée de la prestation, par barbier. La base refuse
toute double réservation d'un même barbier (verrou + contrôle de chevauchement).

Sources
- Fiche Google Maps « .CUT barbershop » (Tlemcen) : note 5,0 (18 avis), téléphone 0672 01 57 99,
  horaires, plus code VMPF+GH, photos, extraits d'avis.
- TikTok @barber_r13 (« Point Cut barber »), lien indiqué sur la fiche.

À confirmer avec le salon
- Liste des prestations, prix et durées : EXEMPLES, modifiables dans l'espace salon.
- Rue exacte (la fiche indique seulement « Tlemcen »).
- Le numéro sur l'enseigne semble finir par 90, la fiche Google indique 99.
