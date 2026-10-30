import {
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  Camera01Icon,
  Cancel01Icon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CommandIcon,
  ComputerIcon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  FavouriteIcon,
  FireIcon,
  GlobalIcon,
  HardDriveIcon,
  ImageAdd01Icon,
  InboxIcon,
  InformationCircleIcon,
  Key01Icon,
  LinkSquare02Icon,
  Loading03Icon,
  LockIcon,
  Logout01Icon,
  Mail01Icon,
  Message01Icon,
  Mic01Icon,
  MicOff01Icon,
  MinusSignIcon,
  MonitorOffIcon,
  Moon02Icon,
  MoreHorizontalIcon,
  Notification01Icon,
  PauseIcon,
  PencilEdit01Icon,
  PencilEdit02Icon,
  PlayIcon,
  Radio01Icon,
  RecordIcon,
  RefreshIcon,
  ReplyIcon,
  RotateLeft01Icon,
  RotateRight01Icon,
  RssIcon,
  Search01Icon,
  SentIcon,
  Settings02Icon,
  SidebarLeftIcon,
  SourceCodeIcon,
  SparklesIcon,
  StopIcon,
  Sun03Icon,
  Target02Icon,
  Tick02Icon,
  TrophyIcon,
  UserAdd01Icon,
  UserGroupIcon,
  UserIcon,
  Video01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type HugeiconsProps, type IconSvgElement } from "@hugeicons/react";
import type { ComponentType } from "react";

/** Props every icon accepts: the SVG's own, so `className="size-4"` and `aria-hidden` just work. */
export type IconProps = Omit<HugeiconsProps, "icon" | "altIcon" | "showAlt">;
export type IconComponent = ComponentType<IconProps>;

/** Hugeicons are drawn on a 1.5px grid; a touch heavier holds up at the 16px the UI mostly uses. */
const STROKE = 1.6;

function icon(svg: IconSvgElement): IconComponent {
  const Icon: IconComponent = (props) => (
    <HugeiconsIcon strokeWidth={STROKE} {...props} icon={svg} />
  );
  return Icon;
}

export const AlertTriangle = icon(Alert02Icon);
export const ArrowLeft = icon(ArrowLeft02Icon);
export const ArrowRight = icon(ArrowRight02Icon);
export const Bell = icon(Notification01Icon);
export const Camera = icon(Camera01Icon);
export const Check = icon(Tick02Icon);
export const ChevronDown = icon(ArrowDown01Icon);
export const ChevronLeft = icon(ArrowLeft01Icon);
export const ChevronRight = icon(ArrowRight01Icon);
export const CircleAlert = icon(AlertCircleIcon);
export const CircleCheck = icon(CheckmarkCircle02Icon);
export const CircleDot = icon(RecordIcon);
export const Clock = icon(Clock01Icon);
export const Command = icon(CommandIcon);
export const Copy = icon(Copy01Icon);
export const Download = icon(Download01Icon);
export const ExternalLink = icon(LinkSquare02Icon);
export const Eye = icon(ViewIcon);
export const FileCode2 = icon(SourceCodeIcon);
export const Flame = icon(FireIcon);
export const Globe = icon(GlobalIcon);
export const HardDrive = icon(HardDriveIcon);
export const Heart = icon(FavouriteIcon);
export const ImagePlus = icon(ImageAdd01Icon);
export const Inbox = icon(InboxIcon);
export const Info = icon(InformationCircleIcon);
export const KeyRound = icon(Key01Icon);
export const ListChecks = icon(CheckListIcon);
export const LoaderCircle = icon(Loading03Icon);
export const Lock = icon(LockIcon);
export const LogOut = icon(Logout01Icon);
export const Mail = icon(Mail01Icon);
export const MessageCircle = icon(Message01Icon);
export const Mic = icon(Mic01Icon);
export const MicOff = icon(MicOff01Icon);
export const Minus = icon(MinusSignIcon);
export const Monitor = icon(ComputerIcon);
export const MonitorX = icon(MonitorOffIcon);
export const MoreHorizontal = icon(MoreHorizontalIcon);
export const Moon = icon(Moon02Icon);
export const PanelLeftClose = icon(SidebarLeftIcon);
export const Pause = icon(PauseIcon);
export const Pencil = icon(PencilEdit02Icon);
export const Play = icon(PlayIcon);
export const Radio = icon(Radio01Icon);
export const Reply = icon(ReplyIcon);
export const RefreshCw = icon(RefreshIcon);
export const RotateCcw = icon(RotateLeft01Icon);
export const RotateCw = icon(RotateRight01Icon);
export const Rss = icon(RssIcon);
export const Search = icon(Search01Icon);
export const Send = icon(SentIcon);
export const Settings = icon(Settings02Icon);
export const Sparkles = icon(SparklesIcon);
export const Square = icon(StopIcon);
export const SquarePen = icon(PencilEdit01Icon);
export const Sun = icon(Sun03Icon);
export const Target = icon(Target02Icon);
export const Trash2 = icon(Delete02Icon);
export const Trophy = icon(TrophyIcon);
export const User = icon(UserIcon);
export const UserPlus = icon(UserAdd01Icon);
export const Users = icon(UserGroupIcon);
export const Video = icon(Video01Icon);
export const X = icon(Cancel01Icon);
