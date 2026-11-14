import React, { createContext, useContext, useState, useEffect } from "react";

export type Locale = "en" | "fr" | "ar";

export interface Translations {
  leaderboard: string;
  codeforces: string;
  codingame: string;
  stats: string;
  compare: string;
  syncHealth: string;
  searchPlaceholder: string;
  allCohorts: string;
  filterCohort: string;
  thisWeek: string;
  allTime: string;
  contestRating: string;
  rank: string;
  member: string;
  solved: string;
  streak: string;
  rating: string;
  language: string;
  pressSlashToSearch: string;
}

export const TRANSLATIONS: Record<Locale, Translations> = {
  en: {
    leaderboard: "Leaderboard",
    codeforces: "Codeforces",
    codingame: "CodinGame",
    stats: "Stats",
    compare: "Compare",
    syncHealth: "Sync health",
    searchPlaceholder: "Search by name, username or school",
    allCohorts: "All cohorts",
    filterCohort: "Filter by cohort / school",
    thisWeek: "This week",
    allTime: "All time",
    contestRating: "Contest",
    rank: "Rank",
    member: "Member",
    solved: "Solved",
    streak: "Streak",
    rating: "Rating",
    language: "Language",
    pressSlashToSearch: "Press / to focus search"
  },
  fr: {
    leaderboard: "Classement",
    codeforces: "Codeforces",
    codingame: "CodinGame",
    stats: "Statistiques",
    compare: "Comparer",
    syncHealth: "État synchro",
    searchPlaceholder: "Rechercher par nom, pseudo ou école",
    allCohorts: "Toutes les cohortes",
    filterCohort: "Filtrer par cohorte / école",
    thisWeek: "Cette semaine",
    allTime: "Tout temps",
    contestRating: "Concours",
    rank: "Rang",
    member: "Membre",
    solved: "Résolus",
    streak: "Série",
    rating: "Score",
    language: "Langue",
    pressSlashToSearch: "Appuyez sur / pour rechercher"
  },
  ar: {
    leaderboard: "لوحة الصدارة",
    codeforces: "كودفورسز",
    codingame: "كودين جيم",
    stats: "الإحصائيات",
    compare: "مقارنة",
    syncHealth: "حالة المزامنة",
    searchPlaceholder: "ابحث بالاسم أو اسم المستخدم أو المدرسة",
    allCohorts: "جميع المجموعات",
    filterCohort: "تصفية حسب المجموعة / المدرسة",
    thisWeek: "هذا الأسبوع",
    allTime: "كل الأوقات",
    contestRating: "المسابقات",
    rank: "الترتيب",
    member: "العضو",
    solved: "المحلولة",
    streak: "التتابع",
    rating: "التقييم",
    language: "اللغة",
    pressSlashToSearch: "اضغط / للتركيز على البحث"
  }
};

const STORAGE_KEY = "leeterboard_locale";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {},
  t: TRANSLATIONS.en,
  isRTL: false
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "en";
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved && (saved === "en" || saved === "fr" || saved === "ar")) return saved;
      const navLang = navigator.language?.toLowerCase() || "";
      if (navLang.startsWith("ar")) return "ar";
      if (navLang.startsWith("fr")) return "fr";
    } catch {
      // Storage unavailable
    }
    return "en";
  });

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable
    }
  };

  const isRTL = locale === "ar";

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
  }, [locale, isRTL]);

  const t = TRANSLATIONS[locale] || TRANSLATIONS.en;

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, isRTL }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
