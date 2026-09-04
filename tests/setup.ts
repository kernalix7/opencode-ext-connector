import { afterAll } from "bun:test"

import { prepareTestPackage, TEST_PACKAGE_ROOT_ENV } from "./support/test-package"

const testPackage = await prepareTestPackage()
process.env[TEST_PACKAGE_ROOT_ENV] = testPackage.root

afterAll(async () => {
  await testPackage.cleanup()
})
