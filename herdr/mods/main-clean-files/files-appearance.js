// Module-local palettes only: never changes Herdr/GPUI's application theme.
import {githubMarkdownLight,githubMarkdownDark} from "./github-markdown-theme.js";
export const FILES_APPEARANCE_KEY = 'main-clean-files.appearance';
function documentTheme(p,dark){
  const github=dark?githubMarkdownDark:githubMarkdownLight;
  return {
    dark,
    source:{
      background:p.background,foreground:p.foreground,gutterBackground:p.chrome??p.surface,
      lineNumber:p.dim,activeLineNumber:p.foreground,selection:dark?'#264f78cc':'#b6e3ffcc',
    },
    markdown:{
      background:github.background,foreground:github.foreground,muted:github.muted,link:github.link,heading:github.foreground,
      inlineCodeBackground:github.inlineCodeBackground,inlineCodeForeground:github.foreground,
      codeBlockBackground:github.codeBlockBackground,quoteBackground:github.background,quoteBorder:github.quoteBorder,
      tableHeaderBackground:github.tableAltBackground,tableHeaderForeground:github.foreground,
      tableBodyBackground:github.tableBodyBackground,tableAltBackground:github.tableAltBackground,tableBorder:github.border,
    },
  };
}
export function filesLook(value, appTheme, appDark) {
  const mode = value === 'light' || value === 'dark' ? value : 'app';
  if (mode === 'app')return{mode,dark:Boolean(appDark),palette:appTheme,document:documentTheme(appTheme,Boolean(appDark))};
  const dark = mode === 'dark';
  const light = {
    background:'#ffffff', canvas:'#ffffff', chrome:'#f6f8fa', surface:'#f6f8fa', raised:'#eaeef2', hover:'#eaeef2', selected:'#ddf4ff',
    border:'#d0d7de', input:'#8c959f', foreground:'#24292f', muted:'#57606a', dim:'#6e7781', accent:'#0969da', accent_foreground:'#ffffff', selection:'#b6e3ff',
    blocked:'#9a6700', ansi0:'#24292e', ansi1:'#d73a49', ansi2:'#22863a', ansi3:'#735c0f', ansi4:'#005cc5', ansi5:'#6f42c1', ansi6:'#032f62', ansi7:'#6a737d',
  };
  const night = {
    background:'#24292e', canvas:'#24292e', chrome:'#1f2428', surface:'#2b3137', raised:'#343b43', hover:'#343b43', selected:'#264f78',
    border:'#444d56', input:'#586069', foreground:'#e1e4e8', muted:'#b1bac4', dim:'#959da5', accent:'#79b8ff', accent_foreground:'#24292e', selection:'#264f78',
    blocked:'#ffab70', ansi0:'#24292e', ansi1:'#f97583', ansi2:'#85e89d', ansi3:'#ffea7f', ansi4:'#79b8ff', ansi5:'#b392f0', ansi6:'#9ecbff', ansi7:'#e1e4e8',
  };
  const palette={...appTheme,...(dark?night:light)};
  return{mode,dark,palette,document:documentTheme(palette,dark)};
}
