#!/usr/bin/env node
const FS = require('fs')
const { promises: fs } = require('fs')
const { Command } = require('commander')
const FormData = require('form-data')

const { requestUploadUrl } = require('../lib/request-upload-url')
const modLib = require('../lib/get-module-id')
const identity = require('../lib/identity')
const registryApis = require('../lib/registry-webapis')

const submit = (form, url) => new Promise((resolve, reject) => {
  form.submit(url, (err, res) => {
    if (err) {
      return reject(err)
    }

    const buffs = []
    res.on('data', (chunk) => buffs.push(chunk))
    res.on('end', () => {
      console.log({ buffs })
      resolve(Buffer.concat(buffs))
    })

    res.on('error', reject)
  })
})

const uploadArtifact = async (uploadURL, compressedFileName, compressedFileBuffer) => {
  const { url, fields } = uploadURL
  const form = new FormData()
  Object.entries(fields).forEach(([field, value]) => {
    form.append(field, value)
  })

  form.append('file', compressedFileBuffer)

  const res = await submit(form, url)

  console.log({ res: res.toString() })
}

async function publish (compressedFileName, moduleId, account = 'default') {
  const data = await fs.readFile(compressedFileName)

  let urlResponse
  try {
    const id = identity.getAccount(account)
    // console.log({ id })
    urlResponse = await requestUploadUrl(id, moduleId, data)
  } catch (e) {
    if (e.stats == null) {
      throw e
    }

    return console.error(e.stats.responseText)
  }

  await uploadArtifact(urlResponse.uploadURL, compressedFileName, data)

  console.log(`Preview URL: ${urlResponse.previewUrl}`)
}

async function configure (account = 'default') {
  // let urlResponse
  let id
  try {
    id = identity.getAccount(account)
  } catch (e) {
    if (e.message === `Account [${account}] not found`) {
      id = {
        accountId: '',
        userId: '',
        userApiKey: ''
      }
    }
  }
  const inquirer = require('inquirer')
  // const chalkPipe = require('chalk-pipe')

  const questions = [
    {
      type: 'input',
      name: 'accountId',
      message: 'What\'s the accountId',
      default () { return id.accountId },
      validate (value) {
        const pass = /^\w{3,12}$/.test(value)

        return pass || 'Please enter a valid accountId with a valid string between 3 and 12 chars'
      }
    },
    {
      type: 'input',
      name: 'userId',
      message: 'What\'s the userId',
      default () { return id.userId },
      validate (value) {
        const pass = /^\w{3,12}$/.test(value)

        return pass || 'Please enter a valid userId with a valid string between 3 and 12 chars'
      }
    },
    {
      type: 'password',
      name: 'userApiKey',
      message: `What's the userApiKey [...${id.userApiKey.substr(-3)}]`,
      default () { return id.userApiKey },
      validate (value) {
        const pass = /^\w{48,64}$/.test(value)

        return pass || 'Please enter a valid userApiKey with a valid string between 48 and 64 chars'
      }
    }
  ]

  const answers = await inquirer.prompt(questions)

  identity.saveAccount(account, answers)
}

function getId (account = 'default') {
  try {
    return identity.getAccount(account)
  } catch (e) {
    if (e.message === `Account [${account}] not found`) {
      return {
        accountId: '',
        userId: '',
        userApiKey: ''
      }
    }
  }
}

async function createModule (debug = false, account = 'default') {
  const inquirer = require('inquirer')

  const questions = [
    {
      type: 'input',
      name: 'name',
      message: 'Module\'s the name',
      validate (value) {
        const pass = /^\w[\w\s]{2,48}$/.test(value)

        return pass || 'Please enter a valid Module Name with a valid string between 3 and 12 chars'
      }
    },
    {
      type: 'input',
      name: 'tenantIds',
      message: 'What companies are you building this module for?',
      default () { return '*' },
      validate (value) {
        const pass = value === '*' || /^(?:(:?\w{2,4})\s)*(:?\w{2,4})$/.test(value)

        return pass || 'Please enter *, one code or a list of codes separated by spaces. e.g.: AA BB C8 D2'
      }
    },
    {
      type: 'input',
      name: 'buildDirectory',
      message: 'What\'s the build directory?',
      default () { return 'build' },
      validate (value) {
        const pass = /^\w{3,12}$/.test(value)

        return pass || 'Please enter a valid build directory name with a valid string between 3 and 12 chars'
      }
    },
    {
      type: 'input',
      name: 'mainFile',
      message: 'What\'s the main javascript file?',
      default () { return 'index.js' },
      validate (value) {
        const pass = /^\w{3,18}\.js$/.test(value)

        return pass || 'Please enter a main javascript file with a valid string between 48 and 64 chars'
      }
    },
    {
      type: 'input',
      name: 'prePackCommand',
      message: 'What\'s the pre package command?',
      default () { return 'npm run build' },
      validate (value) {
        const regexp = /^\w([\w\s]{1,64})*?$/
        const pass = regexp.test(value)

        if (debug) {
          console.log({ debug, value, regexp })
        }

        return pass || 'Please enter a valid pre package command'
      }
    }
  ]

  const answers = await inquirer.prompt(questions)

  if (answers.tenantIds.match(/^(?:[A-Za-z0-9]{2,4}\s*?)+$/)) {
    answers.tenantIds = answers.tenantIds.trim().split(/\s+/).map(_ => _.toUpperCase()).sort()
  }

  console.log({ answers })

  const finalAnswer = await inquirer.prompt([{
    type: 'input',
    name: 'correct',
    message: 'Do you confirm all your answers are correct? (yes|no)',
    default () { return 'no' },
    validate (value) {
      const regexp = /^(?:yes|no)$/
      const pass = regexp.test(value.toLowerCase())

      return pass || 'Please answer yes or no'
    }
  }])

  console.log({ finalAnswer })
  if (finalAnswer.correct.toLowerCase() === 'no') {
    return console.log('Ok! Try again later')
  }

  const response = await registryApis.post(identity.getAccount(account), 'create-module', answers)

  const modObject = {
    moduleId: response.module._id,
    ...answers
  }

  modLib.saveModuleId(modObject)

  console.log({ response })
}

async function initialize (account = 'default') {
  // let urlResponse
  const mod = modLib.getModule()

  const inquirer = require('inquirer')
  // const chalkPipe = require('chalk-pipe')

  const questions = [
    {
      type: 'input',
      name: 'moduleId',
      message: 'What\'s the moduleId',
      default () { return mod.moduleId },
      validate (value) {
        const pass = /^\w{3,12}$/.test(value)

        return pass || 'Please enter a valid moduleId with a valid string between 3 and 12 chars'
      }
    }
  ]

  const answers = await inquirer.prompt(questions)

  mod.moduleId = answers.moduleId
  modLib.saveModuleId(mod)
}

async function createPackage (account = 'default') {
  const mod = modLib.getModule()

  try {
    if (mod.prePackageCmd != null) {
      console.log(`Running ${mod.prePackageCmd} ...`)
      require('child_process').execSync(mod.prePackageCmd)
    }
  } catch (err) {
    console.error(err.stderr.toString())

    process.exit(1)
  }

  const yazl = require('yazl')
  const zipfile = new yazl.ZipFile()

  const dir = await fs.opendir(mod.buildDirectory)
  const entries = dir.entries()

  const zipFileName = 'em-module.zip'
  console.log(`creating file ${zipFileName}...`)
  for await (const entry of entries) {
    console.log(`adding ${entry.name}`)
    zipfile.addFile(`${mod.buildDirectory}/${entry.name}`, entry.name)
  }

  return saveZipFile(zipFileName, zipfile)
}

const saveZipFile = (zipFileName, zipfile) => new Promise((resolve) => {
  zipfile.end(() => zipfile.outputStream.pipe(FS.createWriteStream(zipFileName))
    .once('close', () => {
      console.log(`file ${zipFileName} has been created`)

      resolve(zipFileName)
    }))
})

function main () {
  const program = new Command()

  function exitOnError (e) {
    console.error(program.opts().debug ? e : e.message)

    process.exit(1)
  }

  program.version(require('../package').version)
  program.option('-a, --account <accountName>', 'The name of the configured account')
  program.option('-d, --debug', 'Prints more information about the current process')
  program.option('-p, --publish', 'publishes the module right after packaging it')

  function publishAction (zipfile) {
    return publish(zipfile, modLib.getModuleId(), program.opts().account).catch(exitOnError)
  }

  program
    .command('publish <zipfile>')
    .description('Publishes your Everymundo Module')
    .action(publishAction)

  program
    .command('init')
    .description('initializes a module with its id')
    // .option('-a, --account <accountName>', 'The name of the configured account')
    .action(() => initialize(program.opts().account).catch(exitOnError))

  program
    .command('configure')
    .description('configures credentials')
    .option('-a, --account <accountName>', 'The name of the configured account')
    .action(() => configure(program.opts().account).catch(exitOnError))

  program
    .command('create')
    .description('creates a module on our servers')
    .option('-a, --account <accountName>', 'The name of the configured account')
    .action(() => createModule(program.opts().debug, program.opts().account).catch(exitOnError))

  program
    .command('package')
    .description('creates a package file using the pre-defined command')
    .option('-a, --account <accountName>', 'The name of the configured account')
    .option('-p, --publish', 'Publishes the generaged package')
    .action(async () => {
      const zipFileName = await createPackage(program.opts().account).catch(exitOnError)

      console.log({ opts: program.opts() })
      if (program.opts().publish) {
        await publishAction(zipFileName)
      }
    })

  program.parse(process.argv)
}

if (require.main === module) {
  main()
}
