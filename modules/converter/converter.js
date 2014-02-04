util = require('util');
// console.log(util.inspect(arguments[k], false, null, true))

var matches = [],
  scopeDepth = [],
  /**
   * hack to workaround hbs casting all types to string on template context merge
   */
  knownBooleans = [
    'showLoves'
  ];



/**
 * add helper signatures here to help converter differentiate 
 * between {{{foo }}} (helper) and {{{bar}}} (do not escape)
 */
var helperWhitelist = [
  'tel_anchor', 'staticVersion', 'hbstemplates', 'qtyOption'
], hasHelperAnalogInFTL = [
  'toLowerCase', 'toUpperCase', 'visualIterator', 'formatCurrency'
], hasBespokeConversion = [
  '#if', '#eq', '#ne', '#gt', '#gte', '#lt', '#lte', '#each', '#join', '#with', '#unless'
];

/**
 * converts HBS helpers into FTL custom directives 
 * (usually backed by a Java class implementing TemplateModelDirective)
 * @param {String} s HBS template markup
 * @param {String} namespace
 * @return {String}
 */
function hbsHelpers(s, namespace) {
  var 
    i, n, j, m,
    newArgs, exHmatches, hmatches, simpleMatches, matches, handle, handleRegex, regexTriple, re, xx, xxx,
    regex = /{{#(\w+)?[^}]*}}/gim;

  if(namespace) {
    namespace = namespace + '.';
  } else {
    namespace = '';
  }

  // handle {{#helper }}args{{/helper}} -> <@helper.helper var0=arg0 var1=arg1 />
  simpleMatches = s.match(regex);

  if(simpleMatches) {
    // console.log('{{#foo}} matches: ', matches);
    // extract helper handle
    handle = simpleMatches[0].replace('{{#', '');
    handle = handle.substr(0, handle.indexOf(' '));

    if(helperWhitelist.indexOf(handle) > -1) {
      s = s.replace(/{{#([ a-z0-9_\-\.]+)\s+([^}]+)?}}/gim, '<@helper.$1 $2 />');
    }
  }


  // handle {{helper arg0 arg1}} -> <@helper.helper var0=arg0 var1=arg1 />
  re = /{{([a-z0-9_\-]+) ([^}]*)}}/gim;
  while(matches = re.exec(s)) {
    handle = matches[1];
    args = matches[2].trim().split(' ');

    if(hasHelperAnalogInFTL.indexOf(handle) > -1) {
      // console.log(handle);
      // ${arg0!""?analog}
      s = hbsAnalogFtl(s, handle);
    } else {
      // <@helper.helper var0=arg0 var1=arg1 />
      s = hbsCustomHelper(s, matches[0], namespace, handle, args);
    }
  }


  // handle {{{helper arg0 arg1...}}} -> <@helper.helper var0=arg0 var1=arg1 />
  matches = s.match(/{{{([^}]+)}}}/gim);
  if(matches) {
    // console.log(matches);

    for(i=0, n=matches.length; i<n; i++) {
      // console.log('matches[i]: [ ' + i + ' ] --- ' + matches[i]);
      // console.log(matches);

      handle = matches[i].replace(/[{}]*/gim, '');
      // console.log(handle);
      
      // make sure we have an experssion, not a HTML-escaper (space in the call)
      if(handle.indexOf(' ') > -1) {
        xx = handle.split(' ');
        // console.log(matches[i], '---- '  + xx[1]);
        
        handle = xx[0];
        re = '{{{(' + handle + ')([\\s\\.a-z0-9\\-()]+)}}}';
        regexTriple = new RegExp(re, 'gim');
        
        if(xx[1].trim() !== '') {
          while(hmatches = regexTriple.exec(s)) {
            if(hmatches[2].trim().length > 0) {
              // args for helper backing class
              newArgs = '';
              exHmatches = hmatches[2].trim().split(' ');

              for(j=0, m=exHmatches.length; j<m; j++) {
                newArgs += [' var', j, '=', namespace, exHmatches[j], '!""'].join('');
              }
              
              // console.log(newArgs);
              xxx = new RegExp(hmatches[0], 'gim');
              
              s = s.replace(xxx, '<@helper.' + handle + newArgs + '/>');
            }
          }
        } else {
          s = s.replace(regexTriple, '<@helper.$1$2/>');
        }
      }
    }
  }

  return s;
}

/**
 * replaces hbs helper with FTL custom helper
 * <@helper.helper var0=arg0!"" var1=arg1!"" />
 * @param {String} s 
 * @param {String} toReplace Token to replace with converted helper
 * @param {String} namespace
 * @param {String} handle Name of custom helper
 * @param {Array} args
 */
function hbsCustomHelper(s, toReplace, namespace, handle, args) {
  var newHelper = '<@helper.' + handle;

  for(var i=0, n=args.length; i<n; i++) {
    if(args[i] !== '') {
      newHelper += ' var' + i + '=' + namespace + args[i] + '!""';
    }
  }

  newHelper += ' />';
// console.log(newHelper);
  s = s.replace(toReplace, newHelper);

  return s;
}

/**
 * replaces known-hbs helpers with FTL analogues
 */
function hbsAnalogFtl(s, handle) {
  handle = handle.replace('#', '');

  var analogues = {
      formatCurrency : '?string.currency',
      toLowerCase : '?lower_case',
      toUpperCase : '?upper_case',
      visualIterator : ' + 1'
    }, 
    context,
    matches, 
    re = new RegExp('[{]{2,3}' + handle + "([a-z0-9_\\-\\.\\s]+)[}]{2,3}", 'gi');
    // re = /{{(#[a-z0-9_\-\.\?\s]+)}}/gi;

  while(matches = re.exec(s)) {
    context = '${' + matches[1].trim();
    context += (handle != 'visualIterator') ? '!""' : '';
    context += analogues[handle] + '}';

    s = s.replace(matches[0], context);
  }

  return s;
}






function normalizeNamespace(n) {
  n = n || '';
  if(n) n += '.';
  return n;
}

function _applyNamespace(s, type, namespace) {
  var ftlTag = '<#' + type + ' ([\\w]+) as ([\\w]+)>',
    re = new RegExp(ftlTag, 'gim');

  return s.replace(re, '<#' + type + ' (' + namespace + '.$1)![] as $2>');
}








/*******************************************************************************
 **** scope changing block converters                                       ****
 *******************************************************************************/
function _nth(s, type, callbackBlock) {
  var matcher = '{{#' + type + ' ([\\w\\.]+[^}])}}',
    re = new RegExp(matcher, "gim"),
    matches = s.match(re),
    lastMatch, raw;

  if(matches) {
    while(matches.length > 0) {
      lastMatch = matches.pop();
      raw = _convertNth(s, type, lastMatch);
      s = s.replace(raw, callbackBlock(raw));
    }
  }

  return s;  
}

function _convertNth(s, type, match) {
  type = '{{/' + type + '}}';
  
  var ret = '',
    start = s.indexOf(match),
    end = s.indexOf(type, start) + type.length;

  if(start > -1 && end > start) {
    ret = s.substr(start, end - start);
  }

  return ret;
}

function _applyScopingConversion(s, namespace) {
  s = hbsHelpers(s, namespace);
  s = _applyNamespace(s, 'macro', namespace);
  s = hbsTokens(s, namespace);
  s = hbsIf(s, namespace);
  s = hbsUnless(s, namespace);
  s = hbsEq(s, namespace);

  return s;
}


/*******************************************************************************
 **** {{#with}} handlers                                                    ****
 *******************************************************************************/
function hbsWith(s) {
  return _nth(s, 'with', _convertOneWithBlock);
}

function _convertOneWithBlock(s) {
  var matches, handle,
    re = /{{#with\ ([\w\.\d]+)}}/gi;

  while(matches = re.exec(s)) {
    // console.log(matches[0], matches[1]);
    handle = matches[1].replace(/\./g, '_');

    s = s.replace(matches[0], '<#macro with_' + handle + ' ' + handle + ' >');
    s = s.replace(/{{\/with}}/gim, '</#macro><@with_' + handle + ' ' + matches[1].replace(/\.([0-9]){1,}/gim, '[$1]') + '/>');
    s = _applyScopingConversion(s, handle);
  }

  return s;
}

function _convertOneWithBlock_v1(s) {
  var handle = s.match(/{{#with\ [\w\.]+}}/im)[0];

  if(handle) {
    handle = handle.substr(8);
    handle = handle.substr(0, handle.length - 2);

    s = s.replace(/{{#with (.*)}}/gim, '<#macro with_$1 $1>');
    s = s.replace(/{{\/with}}/gim, '</#macro><@with_' + handle + ' ' + handle + '/>');
    s = _applyScopingConversion(s, handle);
  }
  
  return s;
}




/*******************************************************************************
 **** {{#each}} handlers                                                    ****
 *******************************************************************************/
function hbsEach(s) {
  return _nth(s, 'each', _convertOneEachBlock);
}

/**
 * returns one {{#each}}{{/each}} block, tags inclusive, including any embedded {{#each}}'s
 */
function _convertNthEach(s, each) {
  return _convertNth(s, 'each', each);
}

function _convertOneEachBlock(s, namespace) {
  var
    matches, eachStartDelta, newEach = '', 
    beforeEach, innerEach, afterEach, scopeNamespace,
    eachStartIdx = s.search(/{{#each (.*)}}/im),
    eachEndIdx = s.lastIndexOf('{{/each}}'),
    atIndex = /{{([^{]*)@index([^}]*)}}/gim,
    atMatches;

  namespace = namespace || '';
  namespace = normalizeNamespace(namespace);

  if(eachStartIdx > -1) {
    matches = s.match(/{{#each (.*)}}/im);
    beforeEach = s.substr(0, eachStartIdx);
    afterEach = s.substr(eachEndIdx + 9);

    if(matches) {
      scopeNamespace = 'i_' + matches[1].replace(/\./gim, '_');
      newEach = [ '<#list (', namespace, matches[1], ')![] as ', scopeNamespace, '>' ].join(''); // prefix innerEach
      eachStartDelta = matches[0].length;
      innerEach = s.substr(eachStartIdx + eachStartDelta, (eachEndIdx - eachStartIdx - eachStartDelta));

      innerEach = innerEach.replace(/{{this}}/gim, '{{' + scopeNamespace + '}}');

      // sephora each walks up context node chain to find "../foo"
      innerEach = innerEach.replace(/\.\.\//gim, '');
      //innerEach = _applyScopingConversion(innerEach, scopeNamespace);

      // handle {{@index}}
      innerEach = innerEach.replace(/{{@index}}/gim, '${' + scopeNamespace + '_index}');

      var atTmp;
      while(atMatches = atIndex.exec(innerEach)) {
        // in front of @index
        if(atMatches[1] !== '') {
          atTmp = atMatches[0].replace('@index', scopeNamespace + '_index');
          innerEach = innerEach.replace(new RegExp(atMatches[0], 'gim'), atTmp);

          // console.log(atTmp);
        }
      }

      newEach += innerEach;
      newEach += '</#list>';
    }

    s = [ beforeEach, newEach, afterEach ].join('');
  }

  return s;
}


/**
 * inserts ftl markup for macros
 * @param {String} s HBS template markup
 * @param {String} name Macro identifier
 */
function injectMacroHandle(s, name) {
  // dot-notation breaks FTL parsing
  name = name.replace('.', '_');
  return [
    '<#macro ', name, '>\n',
    s, "\n",
    '</#macro>'
  ].join('')
}




/*******************************************************************************
 **** atomic {{#foo}} handlers                                              ****
 *******************************************************************************/
function _getIfToken(namespace, op) {
  var jsIf = [
    '\n<#if ',
    '(', namespace, '$1)?has_content && \n(',
      // booleans
      '  ( ', namespace, '$1?is_boolean && ', namespace, '$1 == true ) || \n',
      // integers
      '  ( ', namespace, '$1?is_number && ', namespace, '$1 != 0 ) || \n',
      // hash
      '  ( ', namespace, '$1?is_hash) || \n', // ?has_content takes care of this
      // sequences
      '  ( ', namespace, '$1?is_sequence) || \n', // ?has_content takes care of this
      // strings
      '  ( ', namespace, '$1?is_string)\n', // ?has_content takes care of this
    ')', // end type + value checks
    '>\n'
  ].join(''),

  invertedIf = [
    '\n<#if !(', namespace, '$1)?? || !(', namespace, '$1)?has_content || ( ', namespace, '$1?is_boolean && ', namespace, '$1 == false)>\n'
  ].join(''),

  

  /**
   * Template for <#if> directives
   */
  comparisons = [
    '\n<#if (', namespace, '$1)?? && (', namespace, '$1)?has_content && ', namespace, '$1 ::OPERATOR:: $2>'
  ].join('');  

  if(op) {
    if(op == 'unless') {
      // {{#unless}}
      return invertedIf;
    } else {
      // {{#[eq|ne|gt|lt|gte|lte]}}
      return comparisons.replace(/::OPERATOR::/gm, op);
    }
  } else {
    // {{#if}}
    return jsIf;
  }
}

/**
 * handlebars {{#if}} only resolves single argument in the JS-truthiness manner
 * @param {String} s HBS template markup
 * @return {String}
 */
function hbsIf(s, namespace) {
  namespace = normalizeNamespace(namespace);

  s = s.replace(/{{#if ([\w\.\?]+[^}])}}/gim, _getIfToken(namespace));
  s = s.replace(/{{else}}/gim, '<#else>');
  s = s.replace(/{{\/if}}/gim, '</#if>');

  return s;
}

/**
 * handlebars {{#unless}} only resolves single argument in an inverted JS-truthiness manner
 * @param {String} s HBS template markup
 * @return {String}
 */
function hbsUnless(s, namespace) {
  namespace = normalizeNamespace(namespace);

  s = s.replace(/{{#unless ([\w\.\?]+[^}])}}/gim, _getIfToken(namespace, 'unless'));
  s = s.replace(/{{\/unless}}/gim, '</#if>');
  return s;
}

function hbsEq(s, namespace) {
  namespace = normalizeNamespace(namespace);

  s = s.replace(/{{#eq ([^} ]+) ([^}]+)}}/gim, _getIfToken(namespace, '=='));
  s = s.replace(/{{\/eq}}/gim, '</#if>');

  s = s.replace(/{{#ne ([^} ]+) ([^}]+)}}/gim, _getIfToken(namespace, '!='));
  s = s.replace(/{{\/ne}}/gim, '</#if>');

  s = s.replace(/{{#lte ([^} ]+) ([^}]+)}}/gim, _getIfToken(namespace, '<='));
  s = s.replace(/{{\/lte}}/gim, '</#if>');

  s = s.replace(/{{#lt ([^} ]+) ([^}]+)}}/gim, _getIfToken(namespace, '<'));
  s = s.replace(/{{\/lt}}/gim, '</#if>');

  s = s.replace(/{{#gte ([^} ]+) ([^}]+)}}/gim, _getIfToken(namespace, '&gt;='));
  s = s.replace(/{{\/gte}}/gim, '</#if>');

  s = s.replace(/{{#gt ([^} ]+) ([^}]+)}}/gim, _getIfToken(namespace, '&gt;'));
  s = s.replace(/{{\/gt}}/gim, '</#if>');

  return s;
}

/**
 * converts HBS comments into FTL comments
 * @param {String} s HBS template markup
 * @return {String}
 */
function hbsComments(s) {
  return s.replace(/{{!(.*)}}/gim, '<#-- $1 -->');
}



























function hbsNoEscape(s, namespace) {
  namespace = normalizeNamespace(namespace);
  s = s.replace(/{{{([a-z0-9_\.]+)}}}/gim, '${' + namespace + '$1!""?html}');
  return s;
}

function hbsTokens(s, namespace) {
  namespace = normalizeNamespace(namespace);

  // donotespace hbs token substitution - confused with hbsHelper syntax - seriously, WTF
  // @hbsNoEscape
  //s = s.replace(/{{{([a-z0-9_\-\.]+)}}}/gim, '${' + namespace + '$1!""}');
  s = hbsNoEscape(s, namespace);

  // remove hbs node navigation notation
  s = s.replace(/\.\.\//gim, '');

  // standard HBS token substition
  // s = s.replace(/{{([ a-z0-9_\-\.\?]+)}}/gim, '${(' + namespace + '$1?c)!""?string}');
  var token, exToken, matches, tokenRe = /{{([a-z0-9_\-\.\?\s]+)}}/gi;

  while(matches = tokenRe.exec(s)) {
    // console.log(matches[0], matches[1]);
    exToken = matches[1].split('.');

    token = matches[1];
    if(exToken.length > 1) {
      token = exToken.pop();
      // console.log(token.substr(0, 2));
    }

    // hacky workaround bools
    if(token.substr(0, 2) == 'is' || knownBooleans.indexOf(token) > -1) {
// console.log(token);
      // make FTL act like hbs - ignore undefineds/nulls
      s = s.replace(matches[0], '${((' + namespace + matches[1] + ')!false)?c}');
    } else if(matches[1].indexOf('_index') < 0) {
      // make FTL act like hbs - ignore undefineds/nulls
      s = s.replace(matches[0], '${' + namespace + matches[1] + '!""}');
    }
  }

  // silly
  s = s.replace('.this!""}', '}');

  // hbs upwards scoping - ftl walks the scope tree up
  s = s.replace(/\.\.\//gim, '');

  // dumb sanity
  if(s.indexOf('this.this')) {
    s = s.replace('this.this', 'this');
  }

  return s;
}

/** 
 * convert hbs' .length to ftl's .size
 */
function hbsSize(s) {
  var regex = /{{([\sa-z0-9\.#{\/]+)\.length([^}]*)}}/gim;

  s = s.replace(regex, '{{$1?size$2}}');
  return s;
}



/**
 * convert {{#join [a,b,c] }} to 
 */
function hbsJoin(s) {
  var re = /{{#join ([a-z0-9\.]+)}}/gim;

  s = s.replace(re, '${$1?join(",")}');
  s = s.replace('{{/join}}', '');
  return s;
}



/**
 * cleanup handlebars droppings
 * @param {String} s Template contents
 * @return {String}
 */
function hbsCleanup(s) {
  // hbs array indice notation to ftl's
  var tmp, matches,
    re_dotNotFtl = /[<|{]+[#@a-z0-9_\.\-\s]+_([0-9]{1,})_*?[^>\]][>|}]+/gim,
    re_dotNot = /[<|{]+[#@a-z0-9_\.\-\s]+\.([0-9]{1,}).*?[^>\]][>|}]+/gim;

  while(matches = re_dotNot.exec(s)) {
    // console.log(matches[0], matches[1]);
    tmp = matches[0].replace('.' + matches[1], '[' + matches[1] + ']');
    s = s.replace(matches[0], tmp);
  }

  // while(matches = re_dotNotFtl.exec(s)) {
  //   tmp = matches[0].replace(matches[1], '[' + matches[1] + '].');
  //   s = s.replace(matches[0], tmp);
  // }

  return s;
}


module.exports = {
  hbsCleanup      : hbsCleanup,
  hbsComments     : hbsComments,
  hbsEach         : hbsEach,
  hbsEq           : hbsEq,
  hbsHelpers      : hbsHelpers,
  hbsIf           : hbsIf,
  hbsJoin         : hbsJoin,
  hbsNoEscape     : hbsNoEscape,
  hbsSize         : hbsSize,
  hbsTokens       : hbsTokens,
  hbsUnless       : hbsUnless,
  hbsWith         : hbsWith,
  injectMacroHandle: injectMacroHandle,



  hbsExplicitLayout : function(s) {
    var layout, regex = /{{!< (\w+)}}/gim;

    matches = s.match(regex);
    if(matches) {
      s = s.replace(regex, '\n<@layout.$1>');
      layout = matches[0].replace('{{!< ', '').replace('}}', '');
      s += '</@layout.' + layout + '>';
    }

    return s;
  },


  hbsIncludes : function(s) {
    return s.replace(/{{> (.*)}}/gim, '<#include "/$1.ftl" />');
  },

  hbsBody : function(s) {
    return s.replace(/{{{body}}}/gim, '<#nested>');
  },

  hbsDefault : function(s) {
    //{{#default 'US' country}}{{/default}}
    s = s.replace(/{{\/default}}/gim, '');
    s = s.replace(/{{#default [\'\"]+([\w\d]+)[\"\']+ ([\w\d]+)}}/gim, '${$2!"$1"}');
    return s;
  },

  hbsContentFor : function(s) {
    s = s.replace(/{{#contentFor [\'|\"](\w+)[\'|\"]}}/gim, '<#global $1>');
    s = s.replace(/{{\/contentFor}}/gim, '</#global>');
    var globals = /<#global \w+>?[^\/#global].*[\s\S\n\r]*?<\/#global>/gim;

    // move to top
    var matches = s.match(globals);

    if(matches) {
      s = s.replace(globals, '');
      s = matches.join("\n") + s;
      s = s.trim();
    }

    return s;
  },

  hbsBlocks : function(s) {
    s = s.replace(/{{{block [\'|\"](\w+)[\'|\"]}}}/gim, '${$1!""}');
    return s;
  }
}