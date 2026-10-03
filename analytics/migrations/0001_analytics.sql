CREATE TABLE visitors (
 id INTEGER PRIMARY KEY, visitor_key TEXT NOT NULL UNIQUE,
 first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
 first_view_at INTEGER, last_view_at INTEGER,
 total_pageviews INTEGER NOT NULL DEFAULT 0, total_visits INTEGER NOT NULL DEFAULT 0,
 first_page_id INTEGER, last_page_id INTEGER, nickname TEXT, nickname_updated_at INTEGER
);
CREATE INDEX visitors_recent ON visitors(last_seen_at DESC);
CREATE INDEX visitors_first ON visitors(first_seen_at);
CREATE TABLE pages (id INTEGER PRIMARY KEY, identity TEXT NOT NULL UNIQUE, route_type TEXT NOT NULL, content_id TEXT, canonical_path TEXT NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
CREATE TABLE page_paths (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id), path TEXT NOT NULL, UNIQUE(page_id,path));
CREATE TABLE referrers (id INTEGER PRIMARY KEY, host TEXT NOT NULL, source_type TEXT NOT NULL, UNIQUE(host,source_type));
CREATE TABLE pageviews (
 id INTEGER PRIMARY KEY, occurred_at INTEGER NOT NULL,
 visitor_id INTEGER NOT NULL REFERENCES visitors(id), page_id INTEGER NOT NULL REFERENCES pages(id), path_id INTEGER NOT NULL REFERENCES page_paths(id), referrer_id INTEGER NOT NULL REFERENCES referrers(id),
 country TEXT, device TEXT NOT NULL, browser TEXT NOT NULL, os TEXT NOT NULL,
 is_visit INTEGER NOT NULL
);
CREATE INDEX pv_time ON pageviews(occurred_at);
CREATE INDEX pv_visitor ON pageviews(visitor_id,occurred_at);
CREATE INDEX pv_page ON pageviews(page_id,occurred_at);
CREATE TABLE search_events (id INTEGER PRIMARY KEY, occurred_at INTEGER NOT NULL, visitor_id INTEGER NOT NULL REFERENCES visitors(id), page_id INTEGER NOT NULL REFERENCES pages(id), query TEXT NOT NULL, normalized_query TEXT NOT NULL, result_count INTEGER NOT NULL);
CREATE INDEX se_time ON search_events(occurred_at);
CREATE INDEX se_visitor ON search_events(visitor_id,occurred_at);
CREATE TABLE search_clicks (id INTEGER PRIMARY KEY, occurred_at INTEGER NOT NULL, visitor_id INTEGER NOT NULL REFERENCES visitors(id), page_id INTEGER NOT NULL REFERENCES pages(id), normalized_query TEXT NOT NULL, rank INTEGER NOT NULL);
CREATE INDEX sc_time ON search_clicks(occurred_at);
CREATE INDEX sc_visitor ON search_clicks(visitor_id,occurred_at);
CREATE TABLE pending_days (date TEXT PRIMARY KEY);
CREATE TABLE daily_stats (date TEXT PRIMARY KEY, pageviews INTEGER NOT NULL, unique_visitors INTEGER NOT NULL, visits INTEGER NOT NULL, new_visitors INTEGER NOT NULL, returning_visitors INTEGER NOT NULL, rolled_at INTEGER NOT NULL);
CREATE TABLE daily_page_stats (page_id INTEGER NOT NULL REFERENCES pages(id), date TEXT NOT NULL, path_id INTEGER NOT NULL REFERENCES page_paths(id), pageviews INTEGER NOT NULL, landings INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, PRIMARY KEY(page_id,date,path_id));
CREATE INDEX dps_date ON daily_page_stats(date);
CREATE TABLE daily_referrer_stats (referrer_id INTEGER NOT NULL REFERENCES referrers(id), date TEXT NOT NULL, pageviews INTEGER NOT NULL, landings INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, PRIMARY KEY(referrer_id,date));
CREATE INDEX drs_date ON daily_referrer_stats(date);
CREATE TABLE daily_breakdowns (date TEXT NOT NULL, dimension TEXT NOT NULL, value TEXT NOT NULL, pageviews INTEGER NOT NULL, PRIMARY KEY(date,dimension,value));
CREATE TABLE daily_search_stats (normalized_query TEXT NOT NULL, date TEXT NOT NULL, searches INTEGER NOT NULL, zero_result_count INTEGER NOT NULL, clicks INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, PRIMARY KEY(normalized_query,date));
CREATE INDEX dss_date ON daily_search_stats(date);
CREATE TABLE external_search_stats (source TEXT NOT NULL, date TEXT NOT NULL, query TEXT NOT NULL, landing_page TEXT NOT NULL, clicks REAL NOT NULL, impressions REAL NOT NULL, ctr REAL NOT NULL, position REAL NOT NULL, synced_at INTEGER NOT NULL, PRIMARY KEY(source,date,query,landing_page));
CREATE INDEX ess_date ON external_search_stats(date);
CREATE TABLE external_sync_days (source TEXT NOT NULL, date TEXT NOT NULL, synced_at INTEGER NOT NULL, PRIMARY KEY(source,date));
CREATE TABLE storage_daily (date TEXT PRIMARY KEY, bytes INTEGER NOT NULL);
CREATE VIEW page_stats AS SELECT page_id,SUM(pageviews) total_pageviews,SUM(landings) total_landings,MIN(first_seen_at) first_view_at,MAX(last_seen_at) last_view_at FROM daily_page_stats GROUP BY page_id;
CREATE VIEW referrer_stats AS SELECT referrer_id,SUM(pageviews) total_pageviews,SUM(landings) total_landings,MIN(first_seen_at) first_seen_at,MAX(last_seen_at) last_seen_at FROM daily_referrer_stats GROUP BY referrer_id;
CREATE VIEW internal_search_stats AS SELECT normalized_query,SUM(searches) total_searches,SUM(zero_result_count) zero_result_count,SUM(clicks) total_clicks,MIN(first_seen_at) first_seen_at,MAX(last_seen_at) last_seen_at FROM daily_search_stats GROUP BY normalized_query;
CREATE TRIGGER pv_summary AFTER INSERT ON pageviews BEGIN
 UPDATE visitors SET total_pageviews=total_pageviews+1,total_visits=total_visits+NEW.is_visit,first_view_at=MIN(COALESCE(first_view_at,NEW.occurred_at),NEW.occurred_at),last_view_at=MAX(COALESCE(last_view_at,0),NEW.occurred_at),last_seen_at=MAX(last_seen_at,NEW.occurred_at),first_page_id=CASE WHEN first_view_at IS NULL OR NEW.occurred_at<first_view_at THEN NEW.page_id ELSE first_page_id END,last_page_id=CASE WHEN COALESCE(last_view_at,0)<=NEW.occurred_at THEN NEW.page_id ELSE last_page_id END WHERE id=NEW.visitor_id;
 INSERT OR IGNORE INTO pending_days VALUES(date(NEW.occurred_at,'unixepoch','+9 hours'));
END;
CREATE TRIGGER se_day AFTER INSERT ON search_events BEGIN
 INSERT OR IGNORE INTO pending_days VALUES(date(NEW.occurred_at,'unixepoch','+9 hours'));
END;
CREATE TRIGGER sc_day AFTER INSERT ON search_clicks BEGIN
 INSERT OR IGNORE INTO pending_days VALUES(date(NEW.occurred_at,'unixepoch','+9 hours'));
END;
