import { z } from "zod";
import { IdSchema } from "./ids";
import { JsonValueSchema } from "./json";
import { DesignNodeSchema } from "./node";

/** Node fields a component property can drive. */
export const BINDING_FIELDS = ["text", "visible", "src", "icon", "target", "href", "placeholder", "label"] as const;
export type BindingField = (typeof BINDING_FIELDS)[number];

/** Connects a property of a component made in AppShape to a field of a node in its tree. */
export const PropBindingSchema = z.strictObject({
  nodeId: IdSchema,
  field: z.enum(BINDING_FIELDS),
});
export type PropBinding = z.infer<typeof PropBindingSchema>;

export const ComponentPropSchema = z.strictObject({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "enum", "node", "array", "object", "function", "unknown"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  /** For bound properties the default is what the component itself shows. */
  default: JsonValueSchema.optional(),
  description: z.string().optional(),
  bindings: z.array(PropBindingSchema).optional(),
});
export type ComponentProp = z.infer<typeof ComponentPropSchema>;

/** The interface of a component frame (a component designed in AppShape). */
export const ComponentDefSchema = z
  .strictObject({
    description: z.string().optional(),
    props: z.array(ComponentPropSchema),
    /**
     * The starter component this one was made from (`button`, `card`, …). Sections that need a
     * starter component use the project's own instead of adding another.
     */
    kit: z.string().min(1).optional(),
  })
  .superRefine((def, ctx) => {
    const seen = new Set<string>();
    def.props.forEach((prop, i) => {
      if (seen.has(prop.name)) ctx.addIssue({ code: "custom", message: `duplicate property ${prop.name}`, path: ["props", i, "name"] });
      seen.add(prop.name);
      if (prop.type === "enum" && !prop.options?.length) {
        ctx.addIssue({ code: "custom", message: `enum property ${prop.name} needs options`, path: ["props", i, "options"] });
      }
    });
  });
export type ComponentDef = z.infer<typeof ComponentDefSchema>;

/** A component detected by the importer (or created by the user). */
export const ComponentSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1),
  /**
   * project  = defined in the app (e.g. src/components/**)
   * ui-kit   = UI library or generated kit (shadcn components/ui/**, node_modules)
   * page-local = defined inside a page/route file
   * user     = created in AppShape, not in code yet
   */
  kind: z.enum(["project", "ui-kit", "page-local", "user"]),
  platform: z.enum(["web", "mobile", "any"]),
  source: z
    .strictObject({
      file: z.string().min(1),
      exportName: z.string().optional(),
      line: z.int().positive().optional(),
    })
    .optional(),
  /** e.g. `shadcn`, `@radix-ui/react-dialog`. */
  library: z.string().optional(),
  props: z.array(ComponentPropSchema).optional(),
  /** Representative rendered tree, used for previews and new instances. */
  preview: DesignNodeSchema.optional(),
  usage: z
    .strictObject({
      instances: z.int().min(0),
      frames: z.array(IdSchema),
    })
    .optional(),
});
export type Component = z.infer<typeof ComponentSchema>;
