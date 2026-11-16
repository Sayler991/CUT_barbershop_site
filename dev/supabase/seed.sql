-- Données de départ (une seule fois). Horaires = fiche Google Maps (nov. 2026).
-- Prestations et prix : EXEMPLES à confirmer avec le salon (to_confirm = true).
insert into cutbarber.hours (dow, closed, open_min, close_min) values
 (0,false,600,1380),(1,false,600,1440),(2,false,600,1380),(3,false,600,1380),
 (4,false,600,1440),(5,false,900,1320),(6,false,600,1440)
on conflict (dow) do nothing;
insert into cutbarber.barbers (name, bio, sort)
select * from (values ('Younes','',1),('Anis','',2)) v where not exists (select 1 from cutbarber.barbers);
insert into cutbarber.services (name, description, price_da, duration_min, to_confirm, sort)
select * from (values
 ('Coupe homme','Coupe aux ciseaux ou à la tondeuse, finitions et coiffage.',600,30,true,1),
 ('Dégradé (fade)','Dégradé américain, taper ou skin fade, contours nets.',800,40,true,2),
 ('Barbe','Taille, contours au rasoir et serviette chaude.',400,20,true,3),
 ('Coupe + barbe','Coupe ou dégradé avec taille de barbe complète.',1100,60,true,4),
 ('Coupe enfant','Pour les moins de 12 ans.',400,25,true,5)
) v where not exists (select 1 from cutbarber.services);
