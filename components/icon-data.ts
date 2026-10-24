// Google Material Symbols（Outlined，weight 400，Apache 2.0）以 SVG 字串打包進擴充功能
// （constitution 第 6 點）。這裡只取出 path；工具列以 JSX 畫出 <svg>（icons.tsx），設定頁以 DOM API 建立，
// 都不使用 innerHTML。本檔不依賴 Preact，設定頁可以單獨使用。
import arrowDropDown from '@material-symbols/svg-400/outlined/arrow_drop_down.svg?raw';
import autoplay from '@material-symbols/svg-400/outlined/autoplay.svg?raw';
import commentsDisabled from '@material-symbols/svg-400/outlined/comments_disabled.svg?raw';
import headphones from '@material-symbols/svg-400/outlined/headphones.svg?raw';
import mouse from '@material-symbols/svg-400/outlined/mouse.svg?raw';
import pausePresentation from '@material-symbols/svg-400/outlined/pause_presentation.svg?raw';
import volumeOff from '@material-symbols/svg-400/outlined/volume_off.svg?raw';
import volumeUp from '@material-symbols/svg-400/outlined/volume_up.svg?raw';
import close from '@material-symbols/svg-400/outlined/close.svg?raw';
import darkMode from '@material-symbols/svg-400/outlined/dark_mode.svg?raw';
import dragIndicator from '@material-symbols/svg-400/outlined/drag_indicator.svg?raw';
import error from '@material-symbols/svg-400/outlined/error.svg?raw';
import help from '@material-symbols/svg-400/outlined/help.svg?raw';
import image from '@material-symbols/svg-400/outlined/image.svg?raw';
import keep from '@material-symbols/svg-400/outlined/keep.svg?raw';
import keepOff from '@material-symbols/svg-400/outlined/keep_off.svg?raw';
import lightbulb from '@material-symbols/svg-400/outlined/lightbulb.svg?raw';
import moreVert from '@material-symbols/svg-400/outlined/more_vert.svg?raw';
import movie from '@material-symbols/svg-400/outlined/movie.svg?raw';
import musicNote from '@material-symbols/svg-400/outlined/music_note.svg?raw';
import photoCamera from '@material-symbols/svg-400/outlined/photo_camera.svg?raw';
import pictureInPictureAlt from '@material-symbols/svg-400/outlined/picture_in_picture_alt.svg?raw';
import progressActivity from '@material-symbols/svg-400/outlined/progress_activity.svg?raw';
import refresh from '@material-symbols/svg-400/outlined/refresh.svg?raw';
import repeat from '@material-symbols/svg-400/outlined/repeat.svg?raw';
import settings from '@material-symbols/svg-400/outlined/settings.svg?raw';
import subtitles from '@material-symbols/svg-400/outlined/subtitles.svg?raw';
import brandingWatermark from '@material-symbols/svg-400/outlined/branding_watermark.svg?raw';
import hd from '@material-symbols/svg-400/outlined/hd.svg?raw';
import check from '@material-symbols/svg-400/outlined/check.svg?raw';
import contentCopy from '@material-symbols/svg-400/outlined/content_copy.svg?raw';
import link from '@material-symbols/svg-400/outlined/link.svg?raw';
import download from '@material-symbols/svg-400/outlined/download.svg?raw';
import graphicEq from '@material-symbols/svg-400/outlined/graphic_eq.svg?raw';
import openInNew from '@material-symbols/svg-400/outlined/open_in_new.svg?raw';
import expandLess from '@material-symbols/svg-400/outlined/keyboard_arrow_up.svg?raw';
import expandMore from '@material-symbols/svg-400/outlined/keyboard_arrow_down.svg?raw';
import folderOpen from '@material-symbols/svg-400/outlined/folder_open.svg?raw';
import myLocation from '@material-symbols/svg-400/outlined/my_location.svg?raw';
import visibility from '@material-symbols/svg-400/outlined/visibility.svg?raw';
import visibilityOff from '@material-symbols/svg-400/outlined/visibility_off.svg?raw';
import edit from '@material-symbols/svg-400/outlined/edit.svg?raw';
import arrowUpward from '@material-symbols/svg-400/outlined/arrow_upward.svg?raw';
import arrowDownward from '@material-symbols/svg-400/outlined/arrow_downward.svg?raw';
import restartAlt from '@material-symbols/svg-400/outlined/restart_alt.svg?raw';
import upgrade from '@material-symbols/svg-400/outlined/upgrade.svg?raw';
import deleteIcon from '@material-symbols/svg-400/outlined/delete.svg?raw';

const SOURCES = {
  autoplay: autoplay,
  comments_disabled: commentsDisabled,
  headphones: headphones,
  mouse: mouse,
  pause_presentation: pausePresentation,
  volume_off: volumeOff,
  volume_up: volumeUp,
  arrow_drop_down: arrowDropDown,
  arrow_downward: arrowDownward,
  arrow_upward: arrowUpward,
  branding_watermark: brandingWatermark,
  check,
  close,
  content_copy: contentCopy,
  delete: deleteIcon,
  dark_mode: darkMode,
  download,
  drag_indicator: dragIndicator,
  edit,
  error,
  expand_less: expandLess,
  expand_more: expandMore,
  folder_open: folderOpen,
  graphic_eq: graphicEq,
  hd,
  help,
  image,
  keep,
  keep_off: keepOff,
  lightbulb,
  link,
  more_vert: moreVert,
  movie,
  music_note: musicNote,
  my_location: myLocation,
  open_in_new: openInNew,
  photo_camera: photoCamera,
  picture_in_picture_alt: pictureInPictureAlt,
  progress_activity: progressActivity,
  refresh,
  repeat,
  restart_alt: restartAlt,
  settings,
  subtitles,
  upgrade,
  visibility,
  visibility_off: visibilityOff,
} as const;

export type IconName = keyof typeof SOURCES;

/** 從 Material Symbols 的 SVG 字串取出 viewBox 與所有 path 的 d 屬性。 */
export function parseSymbolSvg(svg: string): { viewBox: string; paths: string[] } {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 -960 960 960';
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]!);
  return { viewBox, paths };
}

export const PARSED = Object.fromEntries(
  Object.entries(SOURCES).map(([name, svg]) => [name, parseSymbolSvg(svg)]),
) as Record<IconName, { viewBox: string; paths: string[] }>;

/** 以 DOM API 建立圖示（給不使用 Preact 的設定頁），不經過 innerHTML。 */
export function createIconElement(name: IconName, size = 24): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const { viewBox, paths } = PARSED[name];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ytm-icon');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
