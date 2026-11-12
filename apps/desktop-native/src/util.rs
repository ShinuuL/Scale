//! Utilidades de apresentação: formatação de hora ISO 8601 e afins.

use chrono::{DateTime, Local};

/// Formata um ISO 8601 do servidor (UTC) no fuso local:
/// `HH:MM` se for hoje, senão `dd/mm/aaaa HH:MM`. Parse falhou: texto original.
pub fn fmt_message_time(iso: &str) -> String {
    let Ok(dt) = DateTime::parse_from_rfc3339(iso) else {
        return iso.to_string();
    };
    let local = dt.with_timezone(&Local);
    if local.date_naive() == Local::now().date_naive() {
        local.format("%H:%M").to_string()
    } else {
        local.format("%d/%m/%Y %H:%M").to_string()
    }
}

/// Iniciais de um nome para o avatar quadrado ("Ana Souza" -> "AS").
pub fn initials(name: &str) -> String {
    let mut out = String::new();
    for part in name.split_whitespace() {
        if let Some(ch) = part.chars().next() {
            out.extend(ch.to_uppercase());
        }
        if out.chars().count() >= 2 {
            break;
        }
    }
    if out.is_empty() {
        out.push('?');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn utc_iso(l: DateTime<Local>) -> String {
        l.with_timezone(&Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }

    #[test]
    fn formats_today_as_time_only() {
        let now = Local::now();
        let t = now.date_naive().and_hms_opt(12, 34, 0).unwrap();
        let l = Local.from_local_datetime(&t).earliest().unwrap();
        assert_eq!(fmt_message_time(&utc_iso(l)), "12:34");
    }

    #[test]
    fn formats_other_days_with_date_in_local_zone() {
        let t = chrono::NaiveDate::from_ymd_opt(2025, 1, 2)
            .unwrap()
            .and_hms_opt(9, 5, 0)
            .unwrap();
        let l = Local.from_local_datetime(&t).earliest().unwrap();
        assert_eq!(fmt_message_time(&utc_iso(l)), "02/01/2025 09:05");
    }

    #[test]
    fn invalid_iso_returns_original() {
        assert_eq!(fmt_message_time("ontem"), "ontem");
    }

    #[test]
    fn initials_from_name() {
        assert_eq!(initials("Ana Souza"), "AS");
        assert_eq!(initials("bia"), "B");
        assert_eq!(initials(""), "?");
    }
}
