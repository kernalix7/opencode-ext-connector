import { PluginV2 } from "./opencode/beta-api.js"

const plugin: PluginV2.Plugin = PluginV2.define({
  id: "opencode-ext-connector",
  setup: (context) =>
    import("./opencode/v2-setup.js").then((module) => module.setupV2Connector(context)),
})

export default plugin
