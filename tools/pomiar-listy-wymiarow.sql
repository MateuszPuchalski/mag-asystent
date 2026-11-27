/* Pomiar listy „Do zmierzenia". TYLKO ODCZYT: same SELECT-y z NOLOCK.

   Po co: lista przekracza 30 s i nie wiadomo, która część zapytania to robi.
   Jak: SSMS na bazie podmiotu, F5, potem skopiować całą zakładkę „Messages"
   (czasy i odczyty każdego kroku). Krok może trwać dłużej niż minutę.
   Nazwy pól wymiarów i lokalizacji (tw_Pole1) muszą zgadzać się z wertis.env. */
SET NOCOUNT ON;
SET STATISTICS TIME, IO ON;
GO
PRINT '=== 1. licznik (pola wlasne dla kazdej kartoteki) ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT COUNT(*) AS razem FROM tw__Towar t WITH (NOLOCK) OUTER APPLY (SELECT TOP 1 pwd_Tekst03 AS dlugosc, pwd_Tekst02 AS szerokosc, pwd_Tekst01 AS wysokosc FROM pw_Dane WITH (NOLOCK) WHERE pwd_TypObiektu = -14 AND pwd_IdObiektu = t.tw_Id ORDER BY pwd_Id) pw WHERE t.tw_Zablokowany = 0 AND (ISNULL(t.tw_Masa, 0) <= 0 OR ISNULL(t.tw_MasaNetto, 0) <= 0 OR LTRIM(RTRIM(ISNULL(pw.dlugosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.szerokosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.wysokosc, ''))) = '');
GO
PRINT '=== 2. strona REGALY po zmianie ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, t.tw_PodstKodKresk AS ean, 0 AS stan, 0 AS sprzedaz, t.tw_Pole1 AS lokalizacja, t.tw_Masa AS brutto, t.tw_MasaNetto AS netto, pw.dlugosc, pw.szerokosc, pw.wysokosc FROM tw__Towar t WITH (NOLOCK) OUTER APPLY (SELECT TOP 1 pwd_Tekst03 AS dlugosc, pwd_Tekst02 AS szerokosc, pwd_Tekst01 AS wysokosc FROM pw_Dane WITH (NOLOCK) WHERE pwd_TypObiektu = -14 AND pwd_IdObiektu = t.tw_Id ORDER BY pwd_Id) pw   WHERE t.tw_Zablokowany = 0 AND (ISNULL(t.tw_Masa, 0) <= 0 OR ISNULL(t.tw_MasaNetto, 0) <= 0 OR LTRIM(RTRIM(ISNULL(pw.dlugosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.szerokosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.wysokosc, ''))) = '') ORDER BY CASE WHEN LTRIM(RTRIM(ISNULL(t.tw_Pole1, ''))) = '' THEN 1 ELSE 0 END, t.tw_Pole1, t.tw_Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
GO
PRINT '=== 3. sprzedaz z 30 dni, cala kartoteka ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT COUNT(*) FROM (SELECT p.ob_TowId, SUM(p.ob_IloscMag) AS s FROM dok_Pozycja p WITH (NOLOCK) JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId WHERE d.dok_Typ IN (2, 21) AND d.dok_DataWyst >= @odSprzedazy AND NOT (d.dok_Typ = 2 AND (EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_Id = d.dok_DoDokId AND pa.dok_Typ = 21) OR EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_DoDokId = d.dok_Id AND pa.dok_Typ = 21))) GROUP BY p.ob_TowId) x;
GO
PRINT '=== 4. stany, cala kartoteka ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT COUNT(*) FROM (SELECT st_TowId, SUM(st_Stan) AS s FROM tw_Stan WITH (NOLOCK) GROUP BY st_TowId) x;
GO
PRINT '=== 5. strona SPRZEDAZ (domyslna w panelu) ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, t.tw_PodstKodKresk AS ean, ISNULL(s.stan, 0) AS stan, ISNULL(sp.sprzedaz, 0) AS sprzedaz, t.tw_Pole1 AS lokalizacja, t.tw_Masa AS brutto, t.tw_MasaNetto AS netto, pw.dlugosc, pw.szerokosc, pw.wysokosc FROM tw__Towar t WITH (NOLOCK) OUTER APPLY (SELECT TOP 1 pwd_Tekst03 AS dlugosc, pwd_Tekst02 AS szerokosc, pwd_Tekst01 AS wysokosc FROM pw_Dane WITH (NOLOCK) WHERE pwd_TypObiektu = -14 AND pwd_IdObiektu = t.tw_Id ORDER BY pwd_Id) pw LEFT JOIN (SELECT st_TowId, SUM(st_Stan) AS stan FROM tw_Stan WITH (NOLOCK) GROUP BY st_TowId) s ON s.st_TowId = t.tw_Id LEFT JOIN (SELECT p.ob_TowId, SUM(p.ob_IloscMag) AS sprzedaz FROM dok_Pozycja p WITH (NOLOCK) JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId WHERE d.dok_Typ IN (2, 21) AND d.dok_DataWyst >= @odSprzedazy AND NOT (d.dok_Typ = 2 AND (EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_Id = d.dok_DoDokId AND pa.dok_Typ = 21) OR EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_DoDokId = d.dok_Id AND pa.dok_Typ = 21))) GROUP BY p.ob_TowId) sp ON sp.ob_TowId = t.tw_Id WHERE t.tw_Zablokowany = 0 AND (ISNULL(t.tw_Masa, 0) <= 0 OR ISNULL(t.tw_MasaNetto, 0) <= 0 OR LTRIM(RTRIM(ISNULL(pw.dlugosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.szerokosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.wysokosc, ''))) = '') ORDER BY ISNULL(sp.sprzedaz, 0) DESC, ISNULL(s.stan, 0) DESC, t.tw_Symbol, t.tw_Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
GO
PRINT '=== 7. REGALY + na stanie + sprzedane: licznik, tak jak dzis ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT COUNT(*) AS razem FROM tw__Towar t WITH (NOLOCK) OUTER APPLY (SELECT TOP 1 pwd_Tekst03 AS dlugosc, pwd_Tekst02 AS szerokosc, pwd_Tekst01 AS wysokosc FROM pw_Dane WITH (NOLOCK) WHERE pwd_TypObiektu = -14 AND pwd_IdObiektu = t.tw_Id ORDER BY pwd_Id) pw WHERE t.tw_Zablokowany = 0 AND (ISNULL(t.tw_Masa, 0) <= 0 OR ISNULL(t.tw_MasaNetto, 0) <= 0 OR LTRIM(RTRIM(ISNULL(pw.dlugosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.szerokosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.wysokosc, ''))) = '') AND EXISTS (SELECT 1 FROM tw_Stan st WITH (NOLOCK) WHERE st.st_TowId = t.tw_Id AND st.st_Stan > 0) AND EXISTS (SELECT 1 FROM dok_Pozycja p WITH (NOLOCK) JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId WHERE d.dok_Typ IN (2, 21) AND d.dok_DataWyst >= @odSprzedazy AND NOT (d.dok_Typ = 2 AND (EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_Id = d.dok_DoDokId AND pa.dok_Typ = 21) OR EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_DoDokId = d.dok_Id AND pa.dok_Typ = 21))) AND p.ob_TowId = t.tw_Id AND p.ob_IloscMag > 0);
GO
PRINT '=== 8. REGALY + na stanie + sprzedane: strona, tak jak dzis ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, t.tw_PodstKodKresk AS ean, 0 AS stan, 0 AS sprzedaz, t.tw_Pole1 AS lokalizacja, t.tw_Masa AS brutto, t.tw_MasaNetto AS netto, pw.dlugosc, pw.szerokosc, pw.wysokosc FROM tw__Towar t WITH (NOLOCK) OUTER APPLY (SELECT TOP 1 pwd_Tekst03 AS dlugosc, pwd_Tekst02 AS szerokosc, pwd_Tekst01 AS wysokosc FROM pw_Dane WITH (NOLOCK) WHERE pwd_TypObiektu = -14 AND pwd_IdObiektu = t.tw_Id ORDER BY pwd_Id) pw   WHERE t.tw_Zablokowany = 0 AND (ISNULL(t.tw_Masa, 0) <= 0 OR ISNULL(t.tw_MasaNetto, 0) <= 0 OR LTRIM(RTRIM(ISNULL(pw.dlugosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.szerokosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.wysokosc, ''))) = '') AND EXISTS (SELECT 1 FROM tw_Stan st WITH (NOLOCK) WHERE st.st_TowId = t.tw_Id AND st.st_Stan > 0) AND EXISTS (SELECT 1 FROM dok_Pozycja p WITH (NOLOCK) JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId WHERE d.dok_Typ IN (2, 21) AND d.dok_DataWyst >= @odSprzedazy AND NOT (d.dok_Typ = 2 AND (EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_Id = d.dok_DoDokId AND pa.dok_Typ = 21) OR EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_DoDokId = d.dok_Id AND pa.dok_Typ = 21))) AND p.ob_TowId = t.tw_Id AND p.ob_IloscMag > 0) ORDER BY CASE WHEN LTRIM(RTRIM(ISNULL(t.tw_Pole1, ''))) = '' THEN 1 ELSE 0 END, t.tw_Pole1, t.tw_Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
GO
PRINT '=== 9. zbior sprzedanych z wycieciem faktur do paragonow ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT COUNT(*) FROM (SELECT p.ob_TowId FROM dok_Pozycja p WITH (NOLOCK) JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId WHERE d.dok_Typ IN (2, 21) AND d.dok_DataWyst >= @odSprzedazy AND NOT (d.dok_Typ = 2 AND (EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_Id = d.dok_DoDokId AND pa.dok_Typ = 21) OR EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_DoDokId = d.dok_Id AND pa.dok_Typ = 21))) AND p.ob_IloscMag > 0 GROUP BY p.ob_TowId) x;
GO
PRINT '=== 10. zbior sprzedanych bez tego wyciecia ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT COUNT(*) FROM (SELECT p.ob_TowId FROM dok_Pozycja p WITH (NOLOCK) JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId WHERE d.dok_Typ IN (2, 21) AND d.dok_DataWyst >= @odSprzedazy AND p.ob_IloscMag > 0 GROUP BY p.ob_TowId) x;
GO
PRINT '=== 11. KANDYDAT: licznik ze zlaczeniem zamiast EXISTS ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT COUNT(*) AS razem FROM tw__Towar t WITH (NOLOCK) OUTER APPLY (SELECT TOP 1 pwd_Tekst03 AS dlugosc, pwd_Tekst02 AS szerokosc, pwd_Tekst01 AS wysokosc FROM pw_Dane WITH (NOLOCK) WHERE pwd_TypObiektu = -14 AND pwd_IdObiektu = t.tw_Id ORDER BY pwd_Id) pw JOIN (SELECT p.ob_TowId FROM dok_Pozycja p WITH (NOLOCK) JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId WHERE d.dok_Typ IN (2, 21) AND d.dok_DataWyst >= @odSprzedazy AND NOT (d.dok_Typ = 2 AND (EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_Id = d.dok_DoDokId AND pa.dok_Typ = 21) OR EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_DoDokId = d.dok_Id AND pa.dok_Typ = 21))) AND p.ob_IloscMag > 0 GROUP BY p.ob_TowId) f ON f.ob_TowId = t.tw_Id WHERE t.tw_Zablokowany = 0 AND (ISNULL(t.tw_Masa, 0) <= 0 OR ISNULL(t.tw_MasaNetto, 0) <= 0 OR LTRIM(RTRIM(ISNULL(pw.dlugosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.szerokosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.wysokosc, ''))) = '') AND EXISTS (SELECT 1 FROM tw_Stan st WITH (NOLOCK) WHERE st.st_TowId = t.tw_Id AND st.st_Stan > 0);
GO
PRINT '=== 12. KANDYDAT: strona ze zlaczeniem zamiast EXISTS ===';
DECLARE @odSprzedazy varchar(10) = CONVERT(varchar(10), DATEADD(day, -30, GETDATE()), 23);
DECLARE @offset int = 0, @limit int = 50;
SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, t.tw_PodstKodKresk AS ean, 0 AS stan, 0 AS sprzedaz, t.tw_Pole1 AS lokalizacja, t.tw_Masa AS brutto, t.tw_MasaNetto AS netto, pw.dlugosc, pw.szerokosc, pw.wysokosc FROM tw__Towar t WITH (NOLOCK) OUTER APPLY (SELECT TOP 1 pwd_Tekst03 AS dlugosc, pwd_Tekst02 AS szerokosc, pwd_Tekst01 AS wysokosc FROM pw_Dane WITH (NOLOCK) WHERE pwd_TypObiektu = -14 AND pwd_IdObiektu = t.tw_Id ORDER BY pwd_Id) pw   JOIN (SELECT p.ob_TowId FROM dok_Pozycja p WITH (NOLOCK) JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId WHERE d.dok_Typ IN (2, 21) AND d.dok_DataWyst >= @odSprzedazy AND NOT (d.dok_Typ = 2 AND (EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_Id = d.dok_DoDokId AND pa.dok_Typ = 21) OR EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_DoDokId = d.dok_Id AND pa.dok_Typ = 21))) AND p.ob_IloscMag > 0 GROUP BY p.ob_TowId) f ON f.ob_TowId = t.tw_Id WHERE t.tw_Zablokowany = 0 AND (ISNULL(t.tw_Masa, 0) <= 0 OR ISNULL(t.tw_MasaNetto, 0) <= 0 OR LTRIM(RTRIM(ISNULL(pw.dlugosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.szerokosc, ''))) = '' OR LTRIM(RTRIM(ISNULL(pw.wysokosc, ''))) = '') AND EXISTS (SELECT 1 FROM tw_Stan st WITH (NOLOCK) WHERE st.st_TowId = t.tw_Id AND st.st_Stan > 0) ORDER BY CASE WHEN LTRIM(RTRIM(ISNULL(t.tw_Pole1, ''))) = '' THEN 1 ELSE 0 END, t.tw_Pole1, t.tw_Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
GO
SET STATISTICS TIME, IO OFF;
GO
PRINT '=== 6. indeksy i liczby wierszy ===';
EXEC sp_helpindex 'pw_Dane';
EXEC sp_helpindex 'dok__Dokument';
EXEC sp_helpindex 'dok_Pozycja';
SELECT OBJECT_NAME(object_id) AS tabela, SUM(rows) AS wierszy FROM sys.partitions
WHERE index_id IN (0,1) AND OBJECT_NAME(object_id) IN ('tw__Towar','tw_Stan','pw_Dane','dok__Dokument','dok_Pozycja')
GROUP BY object_id;
GO
