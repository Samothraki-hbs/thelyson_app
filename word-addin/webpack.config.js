/* eslint-disable no-undef */

const devCerts = require("office-addin-dev-certs");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");

const urlDev = "https://localhost:3000/";

// Adresse publique du complément Word.
// Définie au moment de la compilation de production.
const urlProd = process.env.THELYSON_WORD_BASE_URL?.trim();

async function getHttpsOptions() {
  const httpsOptions = await devCerts.getHttpsServerOptions();
  return { ca: httpsOptions.ca, key: httpsOptions.key, cert: httpsOptions.cert };
}

module.exports = async (env, options) => {
  const dev = options.mode === "development";

  // En production, refuser un manifeste sans adresse HTTPS valide.
  // Le développement local conserve son manifeste localhost.
  if (!dev) {
    if (
      !urlProd ||
      !urlProd.startsWith("https://") ||
      !urlProd.endsWith("/") ||
      urlProd.includes("localhost") ||
      urlProd.includes("contoso.com")
    ) {
      throw new Error(
        "THELYSON_WORD_BASE_URL doit être une adresse HTTPS publique " +
          "se terminant par / (exemple : https://word.example.com/)."
      );
    }

    const parsedUrl = new URL(urlProd);

    if (
      parsedUrl.origin + "/" !== urlProd ||
      parsedUrl.hostname === "127.0.0.1" ||
      parsedUrl.hostname === "0.0.0.0"
    ) {
      throw new Error(
        "THELYSON_WORD_BASE_URL doit désigner uniquement l'origine HTTPS du complément."
      );
    }
  }

  // En développement, conserver notre API locale.
  // En production, l'adresse est fournie par l'hébergeur.
  const apiBaseUrl = dev ? "https://localhost:3001" : process.env.THELYSON_API_BASE_URL?.trim();

  if (!apiBaseUrl || !apiBaseUrl.startsWith("https://") || apiBaseUrl.endsWith("/")) {
    throw new Error(
      "THELYSON_API_BASE_URL doit contenir une adresse HTTPS " + "sans barre oblique finale."
    );
  }

  const config = {
    devtool: "source-map",
    entry: {
      polyfill: ["core-js/stable", "regenerator-runtime/runtime"],
      taskpane: ["./src/taskpane/taskpane.ts", "./src/taskpane/taskpane.html"],
      commands: "./src/commands/commands.ts",
    },
    output: {
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".html", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
          },
        },
        {
          test: /\.html$/,
          exclude: /node_modules/,
          use: "html-loader",
        },
        {
          test: /\.(png|jpg|jpeg|gif|ico)$/,
          type: "asset/resource",
          generator: {
            filename: "assets/[name][ext][query]",
          },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        _THELYSON_API_BASE_URL_: JSON.stringify(apiBaseUrl),
      }),
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["polyfill", "taskpane"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "assets/*",
            to: "assets/[name][ext][query]",
          },
          {
            from: "manifest*.xml",
            to: "[name]" + "[ext]",

            transform(content) {
              if (dev) {
                // Conserver le manifeste de développement inchangé.
                return content;
              }

              const manifest = content.toString();

              return (
                manifest
                  // Remplacer les adresses locales du complément Word.
                  .split(urlDev)
                  .join(urlProd)

                  // Remplacer l'adresse d'assistance Contoso
                  // par l'accueil de Thélyson Web (temporairement).
                  .replace("https://www.contoso.com/help", `${apiBaseUrl}/`)

                  // Autoriser le domaine du site Thélyson
                  // dans le manifeste Office.
                  .replace(
                    "<AppDomain>https://www.contoso.com</AppDomain>",
                    `<AppDomain>${apiBaseUrl}</AppDomain>`
                  )
              );
            },
          },
        ],
      }),
      new HtmlWebpackPlugin({
        filename: "commands.html",
        template: "./src/commands/commands.html",
        chunks: ["polyfill", "commands"],
      }),
    ],
    devServer: {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      server: {
        type: "https",
        options:
          env.WEBPACK_BUILD || options.https !== undefined
            ? options.https
            : await getHttpsOptions(),
      },
      port: process.env.npm_package_config_dev_server_port || 3000,
    },
  };

  return config;
};
