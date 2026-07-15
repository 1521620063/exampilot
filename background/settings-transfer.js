(function (root) {
  var BACKUP_FORMAT = 'exampilot-settings-backup';
  var BACKUP_VERSION = 1;
  var MAX_CONFIGS = 100;
  var VALID_API_MODES = {
    'chat-completions': true,
    'responses-api': true,
    anthropic: true,
    'custom-template': true
  };
  var CONFIG_STRING_FIELDS = [
    'model',
    'apiKey',
    'customHeadersJson',
    'customBodyJson',
    'templateHeadersJson',
    'templateBodyJson',
    'templateResponseText'
  ];

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function requireString(value, label, allowEmpty) {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
      throw new Error(label + ' 必须是' + (allowEmpty ? '字符串' : '非空字符串'));
    }
    return value;
  }

  function validateConfigUrl(value, index) {
    var url;
    try {
      url = new URL(value);
    } catch (_) {
      throw new Error('第 ' + (index + 1) + ' 个配置的接口地址无效');
    }
    if (url.protocol !== 'https:') {
      throw new Error('第 ' + (index + 1) + ' 个配置的接口地址必须使用 HTTPS');
    }
    return value;
  }

  function normalizeConfig(config, index, usedIds) {
    if (!isPlainObject(config)) {
      throw new Error('第 ' + (index + 1) + ' 个配置格式无效');
    }

    var id = typeof config.id === 'string' && config.id.trim() ? config.id : 'cfg_import_' + (index + 1);
    while (usedIds[id]) id += '_copy';
    usedIds[id] = true;

    var result = {
      id: id,
      name: requireString(config.name, '第 ' + (index + 1) + ' 个配置名称', false),
      url: validateConfigUrl(requireString(config.url, '第 ' + (index + 1) + ' 个接口地址', false), index),
      apiMode: config.apiMode || 'chat-completions',
      selected: config.selected === true
    };

    if (!VALID_API_MODES[result.apiMode]) {
      throw new Error('第 ' + (index + 1) + ' 个配置的接口模式不受支持');
    }

    CONFIG_STRING_FIELDS.forEach(function (field) {
      var value = config[field];
      result[field] = value === undefined ? '' : requireString(value, '第 ' + (index + 1) + ' 个配置的 ' + field, true);
    });
    return result;
  }

  function normalizeSettingsBackup(backup) {
    if (!isPlainObject(backup) || backup.format !== BACKUP_FORMAT) {
      throw new Error('这不是有效的 ExamPilot 配置文件');
    }
    if (backup.version !== BACKUP_VERSION) {
      throw new Error('不支持此配置文件版本，请升级 ExamPilot 后重试');
    }
    if (!isPlainObject(backup.settings)) {
      throw new Error('配置文件缺少 settings 数据');
    }

    var rawConfigs = backup.settings.configList;
    if (!Array.isArray(rawConfigs)) {
      throw new Error('配置文件中的 configList 必须是数组');
    }
    if (rawConfigs.length > MAX_CONFIGS) {
      throw new Error('配置数量不能超过 ' + MAX_CONFIGS + ' 个');
    }

    var usedIds = {};
    var configList = rawConfigs.map(function (config, index) {
      return normalizeConfig(config, index, usedIds);
    });
    var selectedFound = false;
    configList.forEach(function (config) {
      if (config.selected && !selectedFound) {
        selectedFound = true;
      } else {
        config.selected = false;
      }
    });
    if (configList.length && !selectedFound) configList[0].selected = true;

    var customPrompt = requireString(backup.settings.customPrompt, '提示词', true);
    var uiOpacity = Number(backup.settings.uiOpacity);
    if (!Number.isFinite(uiOpacity)) {
      throw new Error('界面透明度格式无效');
    }

    return {
      configList: configList,
      customPrompt: customPrompt,
      uiOpacity: Math.max(0.01, Math.min(uiOpacity, 1))
    };
  }

  function createSettingsBackup(settings) {
    var backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: settings
    };
    var normalized = normalizeSettingsBackup(backup);
    backup.settings = normalized;
    return backup;
  }

  root.ExamPilotSettingsTransfer = {
    createSettingsBackup: createSettingsBackup,
    normalizeSettingsBackup: normalizeSettingsBackup
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.ExamPilotSettingsTransfer;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
