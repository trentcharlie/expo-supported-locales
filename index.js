const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withXcodeProject,
  AndroidConfig,
  withInfoPlist,
} = require("@expo/config-plugins");

const fs = require("fs");
const path = require("path");

/**
 * Adds the actual Localizable.strings files to the iOS project folder. These files are empty and are only used to satisfy Xcode.
 * This is a dangerous mod because it writes to the file system.
 * @type {import('@expo/config-plugins').ConfigPlugin<{locales: string[]}>}
 */
const withIosLocalizableResources = (config, { locales }) => {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const projectRootPath = path.join(config.modRequest.platformProjectRoot);
      const RESOURCES = "Resources";

      const destAlreadyExists = fs.existsSync(
        path.join(projectRootPath, RESOURCES)
      );

      if (!destAlreadyExists) {
        fs.mkdirSync(path.join(projectRootPath, RESOURCES));
      }

      locales.forEach((locale) => {
        const destPath = path.join(
          projectRootPath,
          RESOURCES,
          `${locale}.lproj`
        );

        const destAlreadyExists = fs.existsSync(destPath);

        if (!destAlreadyExists) {
          fs.mkdirSync(destPath);
        }

        fs.writeFileSync(
          path.join(destPath, "Localizable.strings"),
          `/* ${locale} */`
        );
      });

      return config;
    },
  ]);
};

/**
 * Adds a Localizable.strings file reference to the Xcode project for each locale. This is necessary for Xcode to recognize the various languages.
 * @type {import('@expo/config-plugins').ConfigPlugin<{locales: string[]}>}
 */
const withIosLocalizableProject = (config, { locales }) => {
  return withXcodeProject(config, async (config) => {
    const xcodeProject = config.modResults;
    locales.forEach((locale) => {
      // Add the locale to the project
      // Deduplication is handled by the function
      xcodeProject.addKnownRegion(locale);
    });

    xcodeProject.addPbxGroup("Resources", "Resources");

    const localizationVariantGp = xcodeProject.addLocalizationVariantGroup(
      "Localizable.strings"
    );
    const localizationVariantGpKey = localizationVariantGp.fileRef;

    locales.forEach((locale) => {
      // Create a file reference for each locale
      xcodeProject.addResourceFile(
        `Resources/${locale}.lproj/Localizable.strings`,
        { variantGroup: true },
        localizationVariantGpKey
      );
    });
    return config;
  });
};

/**
 * Create res/xml/locales_config.xml file with selected locales
 * @type {import('@expo/config-plugins').ConfigPlugin<{locales: string[]}>}
 * See https://developer.android.com/guide/topics/resources/app-languages#use-localeconfig
 */
const withAndroidLocalizableResources = (config, { locales }) => {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRootPath = path.join(config.modRequest.platformProjectRoot);
      const RESOURCES = "app/src/main/res/xml";

      const destAlreadyExists = fs.existsSync(
        path.join(projectRootPath, RESOURCES)
      );

      if (!destAlreadyExists) {
        fs.mkdirSync(path.join(projectRootPath, RESOURCES), {
          recursive: true,
        });
      }

      const localeStrings = locales
        .map((locale) => `<locale android:name="${locale}" />`)
        .join("\n");

      const xml = `<?xml version="1.0" encoding="utf-8"?>
  <locale-config xmlns:android="http://schemas.android.com/apk/res/android">
    ${localeStrings}
  </locale-config>`;

      fs.writeFileSync(
        path.join(projectRootPath, RESOURCES, "locales_config.xml"),
        xml
      );

      return config;
    },
  ]);
};

/**
 *
 * @param {string} buildGradle
 * @param {string[]} locales
 * @returns
 */
const setAndroidGradleLocalization = (buildGradle, locales) => {
  const localesString = locales.map((locale) => `"${locale}"`).join(", ");

  const resourceConfigurationsString = `resourceConfigurations += [${localesString}]`;

  // There's already an exact match for the resourceConfigurations, so no need to add it again
  if (buildGradle.includes(resourceConfigurationsString)) {
    return buildGradle;
  }

  // There's already a resourceConfigurations, but it's not an exact
  // One day, there might be a cleaner way to do this, but for now, we'll just throw an error and force the user to run expo prebuild --clean
  if (buildGradle.includes("resourceConfigurations")) {
    throw new Error(
      `build.gradle already contains a conflicting resourceConfigurations. Please run expo prebuild with the --clean flag to resolve.`
    );
  }

  // Add the resourceConfigurations to the defaultConfig
  // Mind the indentation
  return buildGradle.replace(
    /defaultConfig\s*{/,
    `defaultConfig {
          resourceConfigurations += [${localesString}]`
  );
};

/**
 * Adds the resourceConfigurations with selected locales to the defaultConfig in the build.gradle file
 * See https://developer.android.com/guide/topics/resources/app-languages#gradle-config
 * @type {import('@expo/config-plugins').ConfigPlugin<{locales: string[]}>}
 */
const withAndroidLocalizableGradle = (config, { locales }) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === "groovy") {
      config.modResults.contents = setAndroidGradleLocalization(
        config.modResults.contents,
        locales
      );
    } else {
      throw new Error(
        `Cannot configure localization because the build.gradle is not groovy`
      );
    }

    return config;
  });
};

/**
 * @type {import('@expo/config-plugins').ConfigPlugin}
 * Add reference to the locales_config.xml file in the AndroidManifest.xml
 */
const withAndroidLocalizableManifest = (config) => {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    const applications = androidManifest.manifest.application;
    if (!applications || !applications[0]) {
      throw new Error(
        `Cannot configure localization because the AndroidManifest.xml is missing an <application> tag`
      );
    }

    applications[0].$["android:localeConfig"] = "@xml/locales_config";
    return config;
  });
};

/**
 *
 * @type {import('@expo/config-plugins').ConfigPlugin<{locales?: string[] }>}
 * @returns
 */
module.exports = (config, { locales = ["en"] }) => {
  config = withInfoPlist(config, (config) => {
    config.modResults["LOCALES_SUPPORTED"] = locales.join(",");
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults
    );

    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      mainApplication,
      "LOCALES_SUPPORTED",
      locales.join(",")
    );
    return config;
  });

  config = withIosLocalizableProject(config, { locales });
  config = withIosLocalizableResources(config, { locales });
  config = withAndroidLocalizableGradle(config, { locales });
  config = withAndroidLocalizableManifest(config);
  config = withAndroidLocalizableResources(config, { locales });

  return config;
};
