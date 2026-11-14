import { cva } from "class-variance-authority";
import { cn } from "../lib/utils";

const avatarVariants = cva("w-10 h-10 rounded-full", {
  variants: {
    size: {
      sm: "w-8 h-8",
      md: "",
      lg: "w-14 h-14",
    },
  },
});

export interface AvatarProps {
  image?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** A round picture of a person. */
export function Avatar({ image = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22400%22%20viewBox%3D%220%200%20400%20400%22%3E%3Crect%20width%3D%22400%22%20height%3D%22400%22%20fill%3D%22%2371717a%22%20fill-opacity%3D%220.16%22%2F%3E%3Ccircle%20cx%3D%22200%22%20cy%3D%22160%22%20r%3D%2276%22%20fill%3D%22%2371717a%22%20fill-opacity%3D%220.34%22%2F%3E%3Cpath%20d%3D%22M60%20400%20C60%20300%20120%20255%20200%20255%20C280%20255%20340%20300%20340%20400Z%22%20fill%3D%22%2371717a%22%20fill-opacity%3D%220.34%22%2F%3E%3C%2Fsvg%3E", size = "md", className }: AvatarProps) {
  return (
    <img src={image} alt="" className={cn(avatarVariants({ size }), "object-cover", className)} />
  );
}
